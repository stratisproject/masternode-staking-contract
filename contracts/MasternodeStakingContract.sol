//SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;
import "@openzeppelin/contracts/utils/Address.sol";

contract MasternodeStakingContract {
    struct Account {
        uint256 balance;
        uint256 lastDividends;
        uint256 lastClaimedBlock;
    }

    mapping(address=>Account) public accounts;

    // Collateral amount for regular registrations.
    uint256 public constant COLLATERAL_AMOUNT = 1_000_000 ether;

    // Collateral amount for legacy '10K' registrations.
    uint256 public constant COLLATERAL_AMOUNT_10K = 100_000 ether;

    // Collateral amount for legacy '50K' registrations.
    uint256 public constant COLLATERAL_AMOUNT_50K = 500_000 ether;

    uint256 public constant WITHDRAWAL_DELAY = 100_800;

    enum RegistrationStatus { UNREGISTERED, REGISTERED, WITHDRAWING }

    bool public initialized;

    uint256 public totalDividends;
    uint256 public totalRegistrations;
    uint256 public totalCollateralAmount;
    uint256 public lastBalance;
    uint256 public withdrawingCollateralAmount;

    mapping(address => RegistrationStatus) public registrationStatus;
    mapping(address => bool) public legacy10K;
    mapping(address => bool) public legacy50K;

    event Registration(address indexed _from);
    event Deregistration(address indexed _from);

    // This contract is intended to be deployed directly into the genesis block, so a constructor cannot be used.
    // In any case, we assume that all the variables defined above will be their type-specific default values until explicitly set.
    // Only one instance of the contract is intended to ever be in existence, as the masternode rewards are minted directly to the contract's address as assigned in the genesis block.

    function assignLegacyAccounts(address[] calldata legacy10Kaccounts, address[] calldata legacy50Kaccounts) public {
        // This method does not contain any access control logic as it would serve very little purpose.
        // As the contract is deployed in the genesis block, this method can be called by the entity initializing the network prior to making the network public.
        // For example, the legacy accounts can be assigned in the next block after genesis, after which no further changes are allowed.
        // The mappings only need to be populated by the time the first masternode account wishes to register, so that it can be determined whether or not they are considered legacy.

        require(!initialized, "Legacy accounts can only be set once");
        
        for (uint i = 0; i < legacy10Kaccounts.length; i++)
        {
            if (legacy10Kaccounts[i] == address(0))
            {
                continue;
            }

            legacy10K[legacy10Kaccounts[i]] = true;
        }

        for (uint i = 0; i < legacy50Kaccounts.length; i++)
        {
            if (legacy50Kaccounts[i] == address(0))
            {
                continue;
            }

            legacy50K[legacy50Kaccounts[i]] = true;
        }

        initialized = true;
    }

    function register() external payable {
        if (legacy10K[msg.sender])
        {
            require(msg.value == COLLATERAL_AMOUNT_10K, "Incorrect collateral amount for legacy 10K node");
        }
        else if (legacy50K[msg.sender])
        {
            require(msg.value == COLLATERAL_AMOUNT_50K, "Incorrect collateral amount for legacy 50K node");
        }
        else
        {
            require(msg.value == COLLATERAL_AMOUNT, "Incorrect collateral amount");
        }
        
        require(registrationStatus[msg.sender] == RegistrationStatus.UNREGISTERED, "Account already registered");

        update(msg.value);

        accounts[msg.sender].balance = 0;
        accounts[msg.sender].lastDividends = totalDividends;
        accounts[msg.sender].lastClaimedBlock = block.number;
        
        registrationStatus[msg.sender] = RegistrationStatus.REGISTERED;
        
        totalRegistrations += 1;
        totalCollateralAmount += msg.value;

        emit Registration(msg.sender);
    }

    function dividendsOwing(address account) internal view returns(uint256) {
        uint256 newDividends = totalDividends - accounts[account].lastDividends;

        return newDividends;
    }

    function update(uint256 registrationOffset) internal {
        // Calculate the accrued rewards since the last time update() was called.

        // Update disbursed rewards. Note that this is independent of the number of blocks since the last time rewards were claimed, and relates only to the changes in the contract balance.
        uint256 amount = address(this).balance - lastBalance - totalCollateralAmount - withdrawingCollateralAmount - registrationOffset;

        if (totalRegistrations > 0)
        {
            // All categories of registered accounts are treated as having identical 'staking' amounts for the purposes of dividing up the rewards.
            totalDividends += (amount / totalRegistrations);
            lastBalance += amount;
        }

        if (registrationOffset > 0)
        {
            return;
        }

        uint256 owing = dividendsOwing(msg.sender);

        if (owing > 0)
        {
            accounts[msg.sender].balance += owing;
            accounts[msg.sender].lastDividends = totalDividends;
        }
    }

    function claimRewards() public {
        // Sends only the rewards accrued by a given masternode account to their account. Their collateral amount is not withdrawn.

        require(registrationStatus[msg.sender] == RegistrationStatus.REGISTERED, "Account not registered");

        update(0);

        uint256 claimAmount = accounts[msg.sender].balance;

        if (claimAmount == 0)
        {
            return;
        }

        accounts[msg.sender].balance -= claimAmount;
        accounts[msg.sender].lastClaimedBlock = block.number;
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
        if (legacy10K[msg.sender])
        {
            applicableCollateral = COLLATERAL_AMOUNT_10K;
        }
        else if (legacy50K[msg.sender])
        {
            applicableCollateral = COLLATERAL_AMOUNT_50K;
        }
        else
        {
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
        require(registrationStatus[msg.sender] == RegistrationStatus.WITHDRAWING, "Account has not started the withdrawal process");
        require((block.number - accounts[msg.sender].lastClaimedBlock) >= WITHDRAWAL_DELAY, "Withdrawal delay has not yet elapsed");

        uint256 applicableCollateral;
        if (legacy10K[msg.sender])
        {
            applicableCollateral = COLLATERAL_AMOUNT_10K;

            // Once a legacy 10K account de-registers they are not eligible to re-register with the relaxed collateral requirements.
            delete legacy10K[msg.sender];
        }
        else if (legacy50K[msg.sender])
        {
            applicableCollateral = COLLATERAL_AMOUNT_50K;

            // Once a legacy 50K account de-registers they are not eligible to re-register with the relaxed collateral requirements.
            delete legacy50K[msg.sender];
        }
        else
        {
            applicableCollateral = COLLATERAL_AMOUNT;
        }

        withdrawingCollateralAmount -= applicableCollateral;

        // Free up storage.
        delete registrationStatus[msg.sender];
        delete accounts[msg.sender];

        Address.sendValue(payable(msg.sender), applicableCollateral);
    }
}
