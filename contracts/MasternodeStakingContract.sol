//SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MasternodeStakingContract {
    struct Account {
        uint256 balance;
        uint256 lastDividends;
        uint256 lastClaimedBlock;
    }

    mapping(address => Account) public accounts;

    // Collateral amount for regular registrations.
    uint256 public constant COLLATERAL_AMOUNT = 1_000_000 ether;

    // Collateral amount for legacy registrations.
    uint256 public constant COLLATERAL_AMOUNT_LEGACY = 100_000 ether;

    uint256 public constant WITHDRAWAL_DELAY = 100_800;

    enum RegistrationStatus {
        UNREGISTERED,
        REGISTERED,
        WITHDRAWING
    }

    bool public initialized;

    uint256 public totalDividends;
    uint256 public totalRegistrations;
    uint256 public totalCollateralAmount;
    uint256 public lastBalance;
    uint256 public withdrawingCollateralAmount;

    mapping(address => RegistrationStatus) public registrationStatus;
    mapping(address => bool) public legacy;

    address public owner;
    uint256 public totalTokensBalance;
    mapping(address => address) public accountRegisterToken;
    mapping(address => bool) public supportedTokens;

    event Registration(address indexed _from);
    event Deregistration(address indexed _from);
    event SetSupportedToken(address indexed _token, bool _supported);
    event OwnershipTransferred(
        address indexed previousOwner,
        address indexed newOwner
    );

    modifier onlyOwner() {
        require(
            (owner == address(0) &&
                msg.sender == 0xbba56672A4c466500fD8C65D55AE618c776b1739) ||
                msg.sender == owner,
            "Not an owner"
        );
        _;
    }

    // This contract is intended to be deployed directly into the genesis block, so a constructor cannot be used.
    // In any case, we assume that all the variables defined above will be their type-specific default values until explicitly set.
    // Only one instance of the contract is intended to ever be in existence, as the masternode rewards are minted directly to the contract's address as assigned in the genesis block.

    function assignLegacyAccounts(address[] calldata legacyAccounts) public {
        // This method does not contain any access control logic as it would serve very little purpose.
        // As the contract is deployed in the genesis block, this method can be called by the entity initializing the network prior to making the network public.
        // For example, the legacy accounts can be assigned in the next block after genesis, after which no further changes are allowed.
        // The mapping only needs to be populated by the time the first masternode account wishes to register, so that it can be determined whether or not they are considered legacy.

        require(!initialized, "Legacy accounts can only be set once");

        for (uint i = 0; i < legacyAccounts.length; i++) {
            if (legacyAccounts[i] == address(0)) {
                continue;
            }

            legacy[legacyAccounts[i]] = true;
        }

        initialized = true;
    }

    function register() external payable {
        _register(address(0), msg.value);
    }

    function registerToken(address token, uint256 amount) external {
        require(supportedTokens[token], "Token not supported");

        _register(token, amount);
    }

    function _register(address token, uint256 amount) internal {
        if (legacy[msg.sender]) {
            require(
                amount == COLLATERAL_AMOUNT_LEGACY,
                "Incorrect collateral amount for legacy node"
            );
        } else {
            require(amount == COLLATERAL_AMOUNT, "Incorrect collateral amount");
        }

        require(
            registrationStatus[msg.sender] == RegistrationStatus.UNREGISTERED,
            "Account already registered"
        );

        if (token != address(0)) {
            IERC20(token).transferFrom(msg.sender, address(this), amount);
            totalTokensBalance += amount;
        }

        update(amount);

        accounts[msg.sender].balance = 0;
        accounts[msg.sender].lastDividends = totalDividends;
        accounts[msg.sender].lastClaimedBlock = block.number;
        accountRegisterToken[msg.sender] = token;

        registrationStatus[msg.sender] = RegistrationStatus.REGISTERED;

        totalRegistrations += 1;
        totalCollateralAmount += amount;

        emit Registration(msg.sender);
    }

    function dividendsOwing(address account) internal view returns (uint256) {
        uint256 newDividends = totalDividends - accounts[account].lastDividends;

        return newDividends;
    }

    function update(uint256 registrationOffset) internal {
        // Calculate the accrued rewards since the last time update() was called.

        // Update disbursed rewards. Note that this is independent of the number of blocks since the last time rewards were claimed, and relates only to the changes in the contract balance.
        uint256 amount = address(this).balance +
            totalTokensBalance -
            lastBalance -
            totalCollateralAmount -
            withdrawingCollateralAmount -
            registrationOffset;

        if (totalRegistrations > 0) {
            // All categories of registered accounts are treated as having identical 'staking' amounts for the purposes of dividing up the rewards.
            totalDividends += (amount / totalRegistrations);
            lastBalance += amount;
        }

        if (registrationOffset > 0) {
            return;
        }

        uint256 owing = dividendsOwing(msg.sender);

        if (owing > 0) {
            accounts[msg.sender].balance += owing;
            accounts[msg.sender].lastDividends = totalDividends;
        }
    }

    function claimRewards() public {
        // Sends only the rewards accrued by a given masternode account to their account. Their collateral amount is not withdrawn.

        require(
            registrationStatus[msg.sender] == RegistrationStatus.REGISTERED,
            "Account not registered"
        );

        update(0);

        uint256 claimAmount = accounts[msg.sender].balance;

        accounts[msg.sender].lastClaimedBlock = block.number;

        if (claimAmount == 0) {
            return;
        }

        accounts[msg.sender].balance -= claimAmount;
        lastBalance -= claimAmount;

        Address.sendValue(payable(msg.sender), claimAmount);
    }

    function startWithdrawal() external {
        // Initiates the process for a masternode account to reclaim their collateral.

        // Need to claim any residual rewards for this account before collateral can be withdrawn.
        // Note that claimRewards checks the registration status.
        claimRewards();

        // They will not be eligible for any rewards during the withdrawal delay period, so we need to adjust the total registrations now.
        totalRegistrations -= 1;

        uint256 applicableCollateral;
        if (legacy[msg.sender]) {
            applicableCollateral = COLLATERAL_AMOUNT_LEGACY;
        } else {
            applicableCollateral = COLLATERAL_AMOUNT;
        }

        // We need this account's collateral to no longer be considered part of the contract's overall balance, but the funds have not actually left yet.
        // Therefore we have to keep the 'in progress' withdrawal accumulated in a variable so that it can be offset within future reward updates.
        withdrawingCollateralAmount += applicableCollateral;
        totalCollateralAmount -= applicableCollateral;

        registrationStatus[msg.sender] = RegistrationStatus.WITHDRAWING;

        emit Deregistration(msg.sender);
    }

    function completeWithdrawal() external {
        require(
            registrationStatus[msg.sender] == RegistrationStatus.WITHDRAWING,
            "Account has not started the withdrawal process"
        );
        require(
            (block.number - accounts[msg.sender].lastClaimedBlock) >=
                WITHDRAWAL_DELAY,
            "Withdrawal delay has not yet elapsed"
        );

        uint256 applicableCollateral;
        if (legacy[msg.sender]) {
            applicableCollateral = COLLATERAL_AMOUNT_LEGACY;

            // Once a legacy account de-registers they are not eligible to re-register with the relaxed collateral requirements.
            delete legacy[msg.sender];
        } else {
            applicableCollateral = COLLATERAL_AMOUNT;
        }

        withdrawingCollateralAmount -= applicableCollateral;

        address token = accountRegisterToken[msg.sender];

        // Free up storage.
        delete registrationStatus[msg.sender];
        delete accounts[msg.sender];
        delete accountRegisterToken[msg.sender];

        if (token != address(0)) {
            totalTokensBalance -= applicableCollateral;
            IERC20(token).transfer(msg.sender, applicableCollateral);
        } else {
            Address.sendValue(payable(msg.sender), applicableCollateral);
        }
    }

    function setSupportedToken(
        address token,
        bool supported
    ) external onlyOwner {
        supportedTokens[token] = supported;
        emit SetSupportedToken(token, supported);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "New owner is the zero address");
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }
}
