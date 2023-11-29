//SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "hardhat/console.sol";

contract MasternodeStakingContract {
    uint256 public constant COLLATERAL_AMOUNT = 1000000 ether;
    // TODO: replace with more accurate constant
    uint256 public constant WITHDRAWAL_DELAY = 84000;

    enum RegistrationStatus { UNREGISTERED, REGISTERED, WITHDRAWING }

    uint256 public totalBlockShares;
    uint256 public lastBlock;
    uint256 public totalRegistrations;
    uint256 public totalCollateralAmount;

    mapping(address => RegistrationStatus) public registrationStatus;
    mapping(address => uint256) public lastClaimedBlock;

    event Registration(address indexed _from);
    event Deregistration(address indexed _from);

    error ImmatureRegistration();
    error UnknownRegistrationStatus();

    constructor() {
        totalBlockShares = 0;
        
        // This gets initialised to its proper value when the first registration matures
        lastBlock = 0;

        totalRegistrations = 0;

        totalCollateralAmount = 0;
    }

    function register() external payable {
        require(msg.value == COLLATERAL_AMOUNT, "Incorrect collateral amount");
        require(registrationStatus[msg.sender] == RegistrationStatus.UNREGISTERED, "Account already registered");

        lastClaimedBlock[msg.sender] = block.number;
        registrationStatus[msg.sender] = RegistrationStatus.REGISTERED;

        // The new registration is not considered part of the total registrations yet, so update the total block shares before incrementing.
        updateBlockShares();

        totalRegistrations += 1;
        totalCollateralAmount += msg.value;

        emit Registration(msg.sender);
    }

    function claimRewards() public {
        require(registrationStatus[msg.sender] == RegistrationStatus.REGISTERED, "Account not registered");

        updateBlockShares();

        uint256 sinceLastClaim = block.number - lastClaimedBlock[msg.sender];

        console.log(sinceLastClaim);
        console.log(address(this).balance);
        console.log(totalBlockShares);
        console.log(totalCollateralAmount);

        // The contract's balance consists of both collateral amounts and the reward amounts added each block.
        // Therefore the collateral amounts have to be tracked separately from the overall balance and removed
        // from it prior to calculating the account's share of the rewards.
        uint256 claimAmount = (address(this).balance - totalCollateralAmount) * sinceLastClaim / totalBlockShares;

        console.log(claimAmount);

        totalBlockShares -= sinceLastClaim;
        lastClaimedBlock[msg.sender] = block.number;

        payable(msg.sender).transfer(claimAmount);
    }

    function startWithdrawal() external {
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

        totalCollateralAmount -= COLLATERAL_AMOUNT;

        payable(msg.sender).transfer(COLLATERAL_AMOUNT);
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