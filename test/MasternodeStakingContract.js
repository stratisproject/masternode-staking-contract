const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
    loadFixture,
    mine,
    setBalance,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("Masternode staking contract", function () {
    async function deployTokenFixture() {
        const [addr1, addr2, addr3, addr10k, addr50k] = await ethers.getSigners();

        const masternodeContract = await ethers.deployContract("MasternodeStakingContract");
    
        await masternodeContract.waitForDeployment();
    
        setBalance(addr1.address, ethers.parseEther("5000000"));
        setBalance(addr2.address, ethers.parseEther("5000000"));
        setBalance(addr3.address, ethers.parseEther("5000000"));
        setBalance(addr10k.address, ethers.parseEther("5000000"));
        setBalance(addr50k.address, ethers.parseEther("5000000"));

        await masternodeContract.assignLegacyAccounts([addr10k], [addr50k]);

        return { masternodeContract, addr1, addr2, addr3, addr10k, addr50k };
    }

    describe("Deployment", function () {
        it("Should set the total dividends amount to 0", async function () {
            const { masternodeContract } = await loadFixture(deployTokenFixture);
        
            expect(await masternodeContract.totalDividends()).to.equal(0);
        });

        it("Should set the total registrations to 0", async function () {
            const { masternodeContract } = await loadFixture(deployTokenFixture);
        
            expect(await masternodeContract.totalRegistrations()).to.equal(0);
        });

        it("Should set the total collateral amount to 0", async function () {
            const { masternodeContract } = await loadFixture(deployTokenFixture);
        
            expect(await masternodeContract.totalCollateralAmount()).to.equal(0);
        });

        it("Should set the last balance amount to 0", async function () {
            const { masternodeContract } = await loadFixture(deployTokenFixture);
        
            expect(await masternodeContract.lastBalance()).to.equal(0);
        });

        it("Should set the withdrawing collateral amount to 0", async function () {
            const { masternodeContract } = await loadFixture(deployTokenFixture);
        
            expect(await masternodeContract.withdrawingCollateralAmount()).to.equal(0);
        });
    });

    describe("Registration", function () {
        it("Shouldn't work with no collateral", async function () {
            const { masternodeContract, addr1 } = await loadFixture(deployTokenFixture);

            await expect(
                masternodeContract.connect(addr1).register()
                ).to.be.revertedWith("Incorrect collateral amount");
            
            expect(await masternodeContract.totalRegistrations()).to.equal(0);
        });

        it("Shouldn't work with insufficient collateral", async function () {
            const { masternodeContract, addr1 } = await loadFixture(deployTokenFixture);

            await expect(
                masternodeContract.connect(addr1).register({ value: ethers.parseEther("999999") })
                ).to.be.revertedWith("Incorrect collateral amount");

            expect(await masternodeContract.totalRegistrations()).to.equal(0);
        });

        it("Shouldn't work with too much collateral", async function () {
            const { masternodeContract, addr1 } = await loadFixture(deployTokenFixture);

            await expect(
                masternodeContract.connect(addr1).register({ value: ethers.parseEther("1000001") })
                ).to.be.revertedWith("Incorrect collateral amount");
            
            expect(await masternodeContract.totalRegistrations()).to.equal(0);
        });

        it("Should work with correct collateral", async function () {
            const { masternodeContract, addr1 } = await loadFixture(deployTokenFixture);

            // Initially unregistered.
            expect(await masternodeContract.registrationStatus(addr1.address)).to.equal(0);

            const tx = masternodeContract.connect(addr1).register({ value: ethers.parseEther("1000000") });

            await expect(tx).to.emit(masternodeContract, "Registration")
                .withArgs(addr1.address);
            
            await expect(tx).to.changeEtherBalance(addr1, -ethers.parseEther("1000000"));

            expect(await masternodeContract.registrationStatus(addr1.address)).to.equal(1);
        });

        it("Shouldn't work a second time for a registered account", async function () {
            const { masternodeContract, addr1 } = await loadFixture(deployTokenFixture);

            // Initially unregistered.
            expect(await masternodeContract.registrationStatus(addr1.address)).to.equal(0);

            await expect(
                masternodeContract.connect(addr1).register({ value: ethers.parseEther("1000000") })
                ).not.to.be.reverted;

            expect(await masternodeContract.registrationStatus(addr1.address)).to.equal(1);

            await expect(
                masternodeContract.connect(addr1).register({ value: ethers.parseEther("1000000") })
                ).to.be.revertedWith("Account already registered");

            // Shouldn't have affected registration status; the account was registered already.
            expect(await masternodeContract.registrationStatus(addr1.address)).to.equal(1);
        });
    });

    describe("Claim rewards", function () {
        it("Shouldn't work if not registered", async function () {
            const { masternodeContract, addr1 } = await loadFixture(deployTokenFixture);

            expect(await masternodeContract.totalRegistrations()).to.equal(0);

            await expect(
                masternodeContract.connect(addr1).claimRewards()
                ).to.be.revertedWith("Account not registered");
        });

        it("Should work if registered", async function () {
            const { masternodeContract, addr1 } = await loadFixture(deployTokenFixture);

            expect(await masternodeContract.totalRegistrations()).to.equal(0);

            await masternodeContract.connect(addr1).register({ value: ethers.parseEther("1000000") });
            
            expect(await masternodeContract.totalRegistrations()).to.equal(1);

            // Registration amount of 1m + 50 ether to be distributed.
            await setBalance(await masternodeContract.getAddress(), ethers.parseEther("1000050"));

            const tx = masternodeContract.connect(addr1).claimRewards();

            await expect(tx).not.to.be.reverted;

            await expect(tx).to.changeEtherBalance(addr1, ethers.parseEther("50"));
            await expect(tx).to.changeEtherBalance(await masternodeContract.getAddress(), -ethers.parseEther("50"));
        });

        it("Should work if registered with a balance already in the contract", async function () {
            const { masternodeContract, addr1 } = await loadFixture(deployTokenFixture);

            // Set the balance first.
            await setBalance(await masternodeContract.getAddress(), ethers.parseEther("50"));

            // Contract balance will now be 1000050 post-registration.
            await masternodeContract.connect(addr1).register({ value: ethers.parseEther("1000000") });
            
            // We expect the reward claiming to give the only registered account all 50 ether.
            const tx = masternodeContract.connect(addr1).claimRewards();

            await expect(tx).not.to.be.reverted;

            await expect(tx).to.changeEtherBalance(addr1, ethers.parseEther("50"));
            await expect(tx).to.changeEtherBalance(await masternodeContract.getAddress(), -ethers.parseEther("50"));
        });

        it("Should work if multiple registrations with a balance already in the contract", async function () {
            const { masternodeContract, addr1, addr2 } = await loadFixture(deployTokenFixture);

            // Set the balance first.
            await setBalance(await masternodeContract.getAddress(), ethers.parseEther("50"));

            // Contract balance will now be 1000050 post first registration.
            await masternodeContract.connect(addr1).register({ value: ethers.parseEther("1000000") });

            // Contract balance will now be 2000050 post second registration.
            await masternodeContract.connect(addr2).register({ value: ethers.parseEther("1000000") });

            // We expect the reward claiming to give the first registered account all 50 ether.
            const tx = masternodeContract.connect(addr1).claimRewards();

            await expect(tx).not.to.be.reverted;

            await expect(tx).to.changeEtherBalance(addr1, ethers.parseEther("50"));
            await expect(tx).to.changeEtherBalance(await masternodeContract.getAddress(), -ethers.parseEther("50"));

            const tx2 = masternodeContract.connect(addr2).claimRewards();

            await expect(tx2).not.to.be.reverted;

            await expect(tx2).to.changeEtherBalance(addr2, ethers.parseEther("0"));
            await expect(tx2).to.changeEtherBalance(await masternodeContract.getAddress(), -ethers.parseEther("0"));
        });

        it("Should have no effect if no balance to claim", async function () {
            const { masternodeContract, addr1 } = await loadFixture(deployTokenFixture);

            await masternodeContract.connect(addr1).register({ value: ethers.parseEther("1000000") });

            // Contract balance will consist of only the collateral provided during the registration.

            const tx = masternodeContract.connect(addr1).claimRewards();

            await expect(tx).not.to.be.reverted;
            await expect(tx).to.changeEtherBalance(addr1, ethers.parseEther("0.00"));
            await expect(tx).to.changeEtherBalance(await masternodeContract.getAddress(), ethers.parseEther("0.00"));
        });

        it("Should only distribute to first account if a second is registered with no contract balance change", async function () {
            const { masternodeContract, addr1, addr2 } = await loadFixture(deployTokenFixture);
            
            await masternodeContract.connect(addr1).register({ value: ethers.parseEther("1000000") });

            // Need to have 1m from first registration + 50 new ether to be distributed
            await setBalance(await masternodeContract.getAddress(), ethers.parseEther("1000050"));

            await masternodeContract.connect(addr2).register({ value: ethers.parseEther("1000000") });

            const tx = masternodeContract.connect(addr1).claimRewards();

            await expect(tx).not.to.be.reverted;

            await expect(tx).to.changeEtherBalance(addr1, ethers.parseEther("50.00"));
            await expect(tx).to.changeEtherBalance(await masternodeContract.getAddress(), -ethers.parseEther("50.00"));

            const tx2 = masternodeContract.connect(addr2).claimRewards();

            await expect(tx2).not.to.be.reverted;

            await expect(tx2).to.changeEtherBalance(addr2, ethers.parseEther("0.00"));
            await expect(tx2).to.changeEtherBalance(await masternodeContract.getAddress(), -ethers.parseEther("0.00"));
        });

        it("Should work for two registered accounts proportionally", async function () {
            const { masternodeContract, addr1, addr2 } = await loadFixture(deployTokenFixture);

            // Initially unregistered.
            expect(await masternodeContract.registrationStatus(addr1.address)).to.equal(0);
            expect(await masternodeContract.registrationStatus(addr2.address)).to.equal(0);

            await masternodeContract.connect(addr1).register({ value: ethers.parseEther("1000000") });
            expect(await masternodeContract.totalRegistrations()).to.equal(1);
            await masternodeContract.connect(addr2).register({ value: ethers.parseEther("1000000") });
            expect(await masternodeContract.totalRegistrations()).to.equal(2);
            expect(await masternodeContract.registrationStatus(addr1.address)).to.equal(1);
            expect(await masternodeContract.registrationStatus(addr2.address)).to.equal(1);

            // Registration 1 (1m) + registration 2 (1m) + 50 ether rewards (to be distributed)
            await setBalance(await masternodeContract.getAddress(), ethers.parseEther("2000050"));

            // Expected result: both accounts were registered prior to the addition of 50 ether to be distributed,
            // so if they both subsequently claim then each should receive 25

            const tx = masternodeContract.connect(addr1).claimRewards();

            await expect(tx).not.to.be.reverted;

            await expect(tx).to.changeEtherBalance(addr1, ethers.parseEther("25.00"));
            await expect(tx).to.changeEtherBalance(await masternodeContract.getAddress(), -ethers.parseEther("25.00"));

            const tx2 = masternodeContract.connect(addr2).claimRewards();

            await expect(tx2).not.to.be.reverted;

            await expect(tx2).to.changeEtherBalance(addr2, ethers.parseEther("25.00"));
            await expect(tx2).to.changeEtherBalance(await masternodeContract.getAddress(), -ethers.parseEther("25.00"));
            });

            it("Should work for three registered accounts proportionally", async function () {
            const { masternodeContract, addr1, addr2, addr3 } = await loadFixture(deployTokenFixture);

            await masternodeContract.connect(addr1).register({ value: ethers.parseEther("1000000") });
            await masternodeContract.connect(addr2).register({ value: ethers.parseEther("1000000") });

            // Registration 1 (1m) + registration 2 (1m) + 50 ether rewards (to be distributed)
            await setBalance(await masternodeContract.getAddress(), ethers.parseEther("2000050"));

            const tx = masternodeContract.connect(addr1).claimRewards();

            await expect(tx).not.to.be.reverted;

            await expect(tx).to.changeEtherBalance(addr1, ethers.parseEther("25.00"));
            await expect(tx).to.changeEtherBalance(await masternodeContract.getAddress(), -ethers.parseEther("25.00"));

            await masternodeContract.connect(addr3).register({ value: ethers.parseEther("1000000") });

            // There would have been 25 ether of rewards left in the contract, so it is effectively being increased by 45 here.
            await setBalance(await masternodeContract.getAddress(), ethers.parseEther("3000070"));

            // Initial 25 from 50/2, plus 15 from 45/3
            const tx2 = masternodeContract.connect(addr2).claimRewards();

            await expect(tx2).not.to.be.reverted;

            await expect(tx2).to.changeEtherBalance(addr2, ethers.parseEther("40.00"));
            await expect(tx2).to.changeEtherBalance(await masternodeContract.getAddress(), -ethers.parseEther("40.00"));

            // Should only have 15 from distributions since addr3 registered
            const tx3 = masternodeContract.connect(addr3).claimRewards();

            await expect(tx3).not.to.be.reverted;

            await expect(tx3).to.changeEtherBalance(addr3, ethers.parseEther("15.00"));
            await expect(tx3).to.changeEtherBalance(await masternodeContract.getAddress(), -ethers.parseEther("15.00"));

            // Addr1 already claimed 25, so it should only be eligible for 15 more
            const tx4 = masternodeContract.connect(addr1).claimRewards();

            await expect(tx4).not.to.be.reverted;

            await expect(tx4).to.changeEtherBalance(addr1, ethers.parseEther("15.00"));
            await expect(tx4).to.changeEtherBalance(await masternodeContract.getAddress(), -ethers.parseEther("15.00"));
            });
        });

    describe("Withdraw collateral", function () {
        it("Shouldn't be able to start withdrawal without being registered", async function () {
            const { masternodeContract, addr1 } = await loadFixture(deployTokenFixture);

            await expect(
                masternodeContract.connect(addr1).startWithdrawal()
                ).to.be.revertedWith("Account not registered");
        });

        it("Should be able to start withdrawal if registered", async function () {
            const { masternodeContract, addr1 } = await loadFixture(deployTokenFixture);

            // Initially unregistered.
            expect(await masternodeContract.registrationStatus(addr1.address)).to.equal(0);

            await expect(
                masternodeContract.connect(addr1).register({ value: ethers.parseEther("1000000") })
                ).not.to.be.reverted;
            
            expect(await masternodeContract.registrationStatus(addr1.address)).to.equal(1);

            await expect(
                masternodeContract.connect(addr1).startWithdrawal()
                ).to.emit(masternodeContract, "Deregistration")
                .withArgs(addr1.address);
        });

        it("Shouldn't be able to start again if already withdrawing", async function () {
            const { masternodeContract, addr1 } = await loadFixture(deployTokenFixture);

            // Initially unregistered.
            expect(await masternodeContract.registrationStatus(addr1.address)).to.equal(0);

            await expect(
                masternodeContract.connect(addr1).register({ value: ethers.parseEther("1000000") })
                ).not.to.be.reverted;
            
            expect(await masternodeContract.registrationStatus(addr1.address)).to.equal(1);

            await expect(
                masternodeContract.connect(addr1).startWithdrawal()
                ).to.emit(masternodeContract, "Deregistration")
                .withArgs(addr1.address);
            
            await expect(
                masternodeContract.connect(addr1).startWithdrawal()
                ).to.be.revertedWith("Account not registered");
        });

        it("Shouldn't be able to complete withdrawal without starting", async function () {
            const { masternodeContract, addr1 } = await loadFixture(deployTokenFixture);

            await expect(
                masternodeContract.connect(addr1).completeWithdrawal()
                ).to.be.revertedWith("Account has not started the withdrawal process");
        });

        it("Shouldn't be able to complete withdrawal early", async function () {
            const { masternodeContract, addr1 } = await loadFixture(deployTokenFixture);

            // Initially unregistered.
            expect(await masternodeContract.registrationStatus(addr1.address)).to.equal(0);

            await expect(
                masternodeContract.connect(addr1).register({ value: ethers.parseEther("1000000") })
                ).not.to.be.reverted;
            
            expect(await masternodeContract.registrationStatus(addr1.address)).to.equal(1);

            await expect(
                masternodeContract.connect(addr1).startWithdrawal()
                ).to.emit(masternodeContract, "Deregistration")
                .withArgs(addr1.address);
            
            // Need to take into account that the transactions above are also advancing the chain.
            mine(100800 - 3);

            await expect(
                masternodeContract.connect(addr1).completeWithdrawal()
                ).to.be.revertedWith("Withdrawal delay has not yet elapsed");
        });

        it("Should be able to complete withdrawal after sufficient time", async function () {
            const { masternodeContract, addr1 } = await loadFixture(deployTokenFixture);

            // Initially unregistered.
            expect(await masternodeContract.registrationStatus(addr1.address)).to.equal(0);

            await expect(
                masternodeContract.connect(addr1).register({ value: ethers.parseEther("1000000") })
                ).not.to.be.reverted;
            
            expect(await masternodeContract.registrationStatus(addr1.address)).to.equal(1);

            await expect(
                masternodeContract.connect(addr1).startWithdrawal()
                ).to.emit(masternodeContract, "Deregistration")
                .withArgs(addr1.address);
            
            mine(100800);

            const tx = masternodeContract.connect(addr1).completeWithdrawal();

            await expect(tx).not.to.be.reverted;

            await expect(tx).to.changeEtherBalance(addr1, ethers.parseEther("1000000"));
            await expect(tx).to.changeEtherBalance(await masternodeContract.getAddress(), -ethers.parseEther("1000000"));
        });
    });

    describe("Legacy collateral", function () {
        it("Shouldn't work for legacy account with no collateral", async function () {
            const { masternodeContract, addr10k, addr50k } = await loadFixture(deployTokenFixture);

            await expect(
                masternodeContract.connect(addr10k).register()
                ).to.be.revertedWith("Incorrect collateral amount for legacy 10K node");

            await expect(
                masternodeContract.connect(addr50k).register()
                ).to.be.revertedWith("Incorrect collateral amount for legacy 50K node");
                
            expect(await masternodeContract.totalRegistrations()).to.equal(0);
        });

        it("Shouldn't work for legacy account with insufficient collateral", async function () {
            const { masternodeContract, addr10k, addr50k } = await loadFixture(deployTokenFixture);

            await expect(
                masternodeContract.connect(addr10k).register({ value: ethers.parseEther("99999") })
                ).to.be.revertedWith("Incorrect collateral amount for legacy 10K node");

            await expect(
                masternodeContract.connect(addr50k).register({ value: ethers.parseEther("499999") })
                ).to.be.revertedWith("Incorrect collateral amount for legacy 50K node");
    
            expect(await masternodeContract.totalRegistrations()).to.equal(0);
        });

        it("Shouldn't work for legacy account with too much collateral", async function () {
            const { masternodeContract, addr10k, addr50k } = await loadFixture(deployTokenFixture);

            await expect(
                masternodeContract.connect(addr10k).register({ value: ethers.parseEther("100001") })
                ).to.be.revertedWith("Incorrect collateral amount for legacy 10K node");

            await expect(
                masternodeContract.connect(addr50k).register({ value: ethers.parseEther("500001") })
                ).to.be.revertedWith("Incorrect collateral amount for legacy 50K node");
    
            expect(await masternodeContract.totalRegistrations()).to.equal(0);
        });

        it("Should work for legacy account with correct collateral", async function () {
            const { masternodeContract, addr10k, addr50k } = await loadFixture(deployTokenFixture);

            // Initially unregistered.
            expect(await masternodeContract.registrationStatus(addr10k.address)).to.equal(0);
            expect(await masternodeContract.registrationStatus(addr50k.address)).to.equal(0);

            const tx = masternodeContract.connect(addr10k).register({ value: ethers.parseEther("100000") });

            await expect(tx).to.emit(masternodeContract, "Registration")
                .withArgs(addr10k.address);
            
            await expect(tx).to.changeEtherBalance(addr10k, -ethers.parseEther("100000"));

            expect(await masternodeContract.registrationStatus(addr10k.address)).to.equal(1);

            const tx2 = masternodeContract.connect(addr50k).register({ value: ethers.parseEther("500000") });

            await expect(tx2).to.emit(masternodeContract, "Registration")
                .withArgs(addr50k.address);
            
            await expect(tx2).to.changeEtherBalance(addr50k, -ethers.parseEther("500000"));

            expect(await masternodeContract.registrationStatus(addr50k.address)).to.equal(1);

            expect(await masternodeContract.totalRegistrations()).to.equal(2);
        });

        it("Shouldn't work a second time for an already registered legacy account", async function () {
            const { masternodeContract, addr10k, addr50k } = await loadFixture(deployTokenFixture);

            // Initially unregistered.
            expect(await masternodeContract.registrationStatus(addr10k.address)).to.equal(0);
            expect(await masternodeContract.registrationStatus(addr50k.address)).to.equal(0);

            await expect(
                masternodeContract.connect(addr10k).register({ value: ethers.parseEther("100000") })
                ).not.to.be.reverted;

            expect(await masternodeContract.registrationStatus(addr10k.address)).to.equal(1);

            await expect(
                masternodeContract.connect(addr10k).register({ value: ethers.parseEther("100000") })
                ).to.be.revertedWith("Account already registered");

            // Shouldn't have affected registration status; the account was registered already.
            expect(await masternodeContract.registrationStatus(addr10k.address)).to.equal(1);

            expect(await masternodeContract.totalRegistrations()).to.equal(1);

            await expect(
                masternodeContract.connect(addr50k).register({ value: ethers.parseEther("500000") })
                ).not.to.be.reverted;

            expect(await masternodeContract.registrationStatus(addr50k.address)).to.equal(1);

            await expect(
                masternodeContract.connect(addr50k).register({ value: ethers.parseEther("500000") })
                ).to.be.revertedWith("Account already registered");

            // Shouldn't have affected registration status; the account was registered already.
            expect(await masternodeContract.registrationStatus(addr50k.address)).to.equal(1);

            expect(await masternodeContract.totalRegistrations()).to.equal(2);
        });

        it("Should get legacy collateral amount when withdrawing", async function () {
            const { masternodeContract, addr10k, addr50k } = await loadFixture(deployTokenFixture);

            expect(await masternodeContract.registrationStatus(addr10k.address)).to.equal(0);

            await expect(
                masternodeContract.connect(addr10k).register({ value: ethers.parseEther("100000") })
                ).not.to.be.reverted;

            await expect(
                masternodeContract.connect(addr50k).register({ value: ethers.parseEther("500000") })
                ).not.to.be.reverted;

            expect(await masternodeContract.registrationStatus(addr10k.address)).to.equal(1);
            expect(await masternodeContract.registrationStatus(addr50k.address)).to.equal(1);

            expect(await masternodeContract.totalRegistrations()).to.equal(2);

            await expect(
                masternodeContract.connect(addr10k).startWithdrawal()
                ).to.emit(masternodeContract, "Deregistration")
                .withArgs(addr10k.address);

            await expect(
                masternodeContract.connect(addr50k).startWithdrawal()
                ).to.emit(masternodeContract, "Deregistration")
                .withArgs(addr50k.address);
    
            expect(await masternodeContract.totalRegistrations()).to.equal(0);

            mine(100800);

            const tx = masternodeContract.connect(addr10k).completeWithdrawal();

            await expect(tx).not.to.be.reverted;

            await expect(tx).to.changeEtherBalance(addr10k, ethers.parseEther("100000"));
            await expect(tx).to.changeEtherBalance(await masternodeContract.getAddress(), -ethers.parseEther("100000"));

            const tx2 = masternodeContract.connect(addr50k).completeWithdrawal();

            await expect(tx2).not.to.be.reverted;

            await expect(tx2).to.changeEtherBalance(addr50k, ethers.parseEther("500000"));
            await expect(tx2).to.changeEtherBalance(await masternodeContract.getAddress(), -ethers.parseEther("500000"));
        });
    });
});
