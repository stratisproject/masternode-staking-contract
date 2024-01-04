//SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;
import "@openzeppelin/contracts/utils/Address.sol";

contract MasternodeStakingContract {
    // Collateral amount for regular registrations.
    uint256 public constant COLLATERAL_AMOUNT = 1_000_000 ether;

    // Collateral amount for legacy '10K' registrations.
    uint256 public constant COLLATERAL_AMOUNT_10K = 100_000 ether;

    // Collateral amount for legacy '50K' registrations.
    uint256 public constant COLLATERAL_AMOUNT_50K = 500_000 ether;

    uint256 public constant WITHDRAWAL_DELAY = 100_800;

    enum RegistrationStatus { UNREGISTERED, REGISTERED, WITHDRAWING }

    bool public initialized;

    uint256 public totalBlockShares;
    uint256 public lastBlock;
    uint256 public totalRegistrations;
    uint256 public totalCollateralAmount;

    mapping(address => RegistrationStatus) public registrationStatus;
    mapping(address => uint256) public lastClaimedBlock;
    mapping(address => bool) public legacy10K;
    mapping(address => bool) public legacy50K;

    event Registration(address indexed _from);
    event Deregistration(address indexed _from);

    // This contract is intended to be deployed directly into the genesis block, so a constructor cannot be used.
    // In any case, we assume that all the variables defined above will be their type-specific default values until explicitly set.
    // Only one instance of the contract is intended to ever be in existence, as the masternode rewards are minted directly to the contract's address as assigned in the genesis.json.

    function assignLegacyAccounts(address[] memory legacy10Kaccounts, address[] memory legacy50Kaccounts) public {
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
            require(msg.value == COLLATERAL_AMOUNT_50K, "Incorrect collateral amount for legacy 50k node");
        }
        else
        {
            require(msg.value == COLLATERAL_AMOUNT, "Incorrect collateral amount");
        }
        
        require(registrationStatus[msg.sender] == RegistrationStatus.UNREGISTERED, "Account already registered");

        lastClaimedBlock[msg.sender] = block.number;
        registrationStatus[msg.sender] = RegistrationStatus.REGISTERED;

        // The new registration is not considered part of the total registrations yet, so update the total block shares before incrementing.
        updateBlockShares();

        totalRegistrations += 1;
        totalCollateralAmount += msg.value;

        emit Registration(msg.sender);
    }

    function checkBlockShares(address masternodeAccount) external view returns (uint256) {
        // This method is called without the preconditions that updateBlockShares() enforces, so it is possible that the
        // account being queried is not registered.
        if (registrationStatus[masternodeAccount] == RegistrationStatus.UNREGISTERED)
        {
            return 0;
        }

        if (lastClaimedBlock[masternodeAccount] == 0)
        {
            return 0;
        }
        
        return block.number - lastClaimedBlock[masternodeAccount];
    }

    function claimRewards() public {
        // Sends only the rewards accrued by a given masternode account to their account. Their collateral amount is not withdrawn.

        require(registrationStatus[msg.sender] == RegistrationStatus.REGISTERED, "Account not registered");

        updateBlockShares();

        if (totalBlockShares == 0)
        {
            return;
        }

        uint256 sinceLastClaim = block.number - lastClaimedBlock[msg.sender];

        if (sinceLastClaim == 0)
        {
            return;
        }

        // The contract's balance consists of both collateral amounts and the reward amounts added each block.
        // Therefore the collateral amounts have to be tracked separately from the overall balance and removed
        // from it prior to calculating the account's share of the rewards.
        uint256 claimAmount = (address(this).balance - totalCollateralAmount) * sinceLastClaim / totalBlockShares;

        if (claimAmount == 0)
        {
            return;
        }

        totalBlockShares -= sinceLastClaim;
        lastClaimedBlock[msg.sender] = block.number;

        // Amount is transferred only after the last claimed block has been reset for the claimer, preventing re-entrancy.
        Address.sendValue(payable(msg.sender), claimAmount);
    }

    function startWithdrawal() external {
        // Initiates the process for a masternode account to reclaim their collateral.

        // Need to claim any residual rewards for this account before collateral can be withdrawn.
        // Note that claimRewards checks the registration status.
        claimRewards();

        totalRegistrations -= 1;

        registrationStatus[msg.sender] = RegistrationStatus.WITHDRAWING;

        emit Deregistration(msg.sender);
    }

    function completeWithdrawal() external {
        require(registrationStatus[msg.sender] == RegistrationStatus.WITHDRAWING, "Account has not started the withdrawal process");
        require((block.number - lastClaimedBlock[msg.sender]) >= WITHDRAWAL_DELAY, "Withdrawal delay has not yet elapsed");

        // Free up the storage used to track the last block this account claimed rewards.
        delete lastClaimedBlock[msg.sender];
        delete registrationStatus[msg.sender];

        uint256 applicableCollateralAmount;

        if (legacy10K[msg.sender])
        {
            applicableCollateralAmount = COLLATERAL_AMOUNT_10K;

            // Once a legacy 10K account de-registers they are not eligible to re-register with the relaxed collateral requirements.
            delete legacy10K[msg.sender];
        }
        else if (legacy50K[msg.sender])
        {
            applicableCollateralAmount = COLLATERAL_AMOUNT_50K;

            // Once a legacy 50K account de-registers they are not eligible to re-register with the relaxed collateral requirements.
            delete legacy50K[msg.sender];
        }
        else
        {
            applicableCollateralAmount = COLLATERAL_AMOUNT;
        }

        totalCollateralAmount -= applicableCollateralAmount;

        Address.sendValue(payable(msg.sender), applicableCollateralAmount);
    }

    function updateBlockShares() internal {
        // Must only perform these updates once per block at most.
        if (lastBlock == block.number)
        {
            return;
        }

        totalBlockShares += (totalRegistrations * (block.number - lastBlock));
        lastBlock = block.number;
    }
}