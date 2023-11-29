const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
    loadFixture,
    mine,
    setBalance,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("Masternode staking contract", function () {
    async function deployTokenFixture() {
        const [addr1, addr2] = await ethers.getSigners();

        const masternodeContract = await ethers.deployContract("MasternodeStakingContract");
    
        await masternodeContract.waitForDeployment();
    
        setBalance(addr1.address, ethers.parseEther("5000000"));
        setBalance(addr2.address, ethers.parseEther("5000000"));

        return { masternodeContract, addr1, addr2 };
    }

    describe("Deployment", function () {
        it("Should set the total block shares to 0", async function () {
            const { masternodeContract } = await loadFixture(deployTokenFixture);
      
            expect(await masternodeContract.totalBlockShares()).to.equal(0);
        });

        it("Should set the last block to 0", async function () {
            const { masternodeContract } = await loadFixture(deployTokenFixture);
        
            expect(await masternodeContract.lastBlock()).to.equal(0);
        });

        it("Should set the total registrations to 0", async function () {
            const { masternodeContract } = await loadFixture(deployTokenFixture);
        
            expect(await masternodeContract.totalRegistrations()).to.equal(0);
        });

        it("Should set the total collateral amount to 0", async function () {
            const { masternodeContract } = await loadFixture(deployTokenFixture);
        
            expect(await masternodeContract.totalCollateralAmount()).to.equal(0);
        });
    });
    
    describe("Registration", function () {
        it("Shouldn't work with no collateral", async function () {
            const { masternodeContract, addr1 } = await loadFixture(deployTokenFixture);

            await expect(
                masternodeContract.connect(addr1).register()
              ).to.be.revertedWith("Incorrect collateral amount");
        });

        it("Shouldn't work with insufficient collateral", async function () {
            const { masternodeContract, addr1 } = await loadFixture(deployTokenFixture);

            await expect(
                masternodeContract.connect(addr1).register({ value: ethers.parseEther("999999") })
              ).to.be.revertedWith("Incorrect collateral amount");
        });

        it("Shouldn't work with too much collateral", async function () {
            const { masternodeContract, addr1 } = await loadFixture(deployTokenFixture);

            await expect(
                masternodeContract.connect(addr1).register({ value: ethers.parseEther("1000001") })
              ).to.be.revertedWith("Incorrect collateral amount");
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

        it("Shouldn't work a second time for the same account", async function () {
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

            await expect(
                masternodeContract.connect(addr1).claimRewards()
                ).to.be.revertedWith("Account not registered");
        });

        it("Should work if registered", async function () {
            const { masternodeContract, addr1 } = await loadFixture(deployTokenFixture);

            await setBalance(await masternodeContract.getAddress(), ethers.parseEther("50"));

            // Initially unregistered.
            expect(await masternodeContract.registrationStatus(addr1.address)).to.equal(0);

            await expect(
                masternodeContract.connect(addr1).register({ value: ethers.parseEther("1000000") })
                ).not.to.be.reverted;
            
            expect(await masternodeContract.registrationStatus(addr1.address)).to.equal(1);

            mine(1);

            const tx = masternodeContract.connect(addr1).claimRewards();

            await expect(tx).not.to.be.reverted;

            // The entire reward balance that the contract has should be sent to the caller as they are the only registration.
            await expect(tx).to.changeEtherBalance(addr1, ethers.parseEther("50"));
            await expect(tx).to.changeEtherBalance(await masternodeContract.getAddress(), -ethers.parseEther("50"));
        });

      it("Should work for two registered accounts proportionally", async function () {
        const { masternodeContract, addr1, addr2 } = await loadFixture(deployTokenFixture);

        await setBalance(await masternodeContract.getAddress(), ethers.parseEther("50"));

        // Initially unregistered.
        expect(await masternodeContract.registrationStatus(addr1.address)).to.equal(0);
        expect(await masternodeContract.registrationStatus(addr2.address)).to.equal(0);

        await expect(
            masternodeContract.connect(addr1).register({ value: ethers.parseEther("1000000") })
            ).not.to.be.reverted;
        
        expect(await masternodeContract.registrationStatus(addr1.address)).to.equal(1);

        mine(1);

        await expect(
            masternodeContract.connect(addr2).register({ value: ethers.parseEther("1000000") })
            ).not.to.be.reverted;
        
        expect(await masternodeContract.registrationStatus(addr2.address)).to.equal(1);

        mine(2);

        // At this point account 1 has 5 block shares out of a total 8, and account 2 has 3
        const tx = masternodeContract.connect(addr1).claimRewards();

        await expect(tx).not.to.be.reverted;

        await expect(tx).to.changeEtherBalance(addr1, ethers.parseEther("31.25"));
        await expect(tx).to.changeEtherBalance(await masternodeContract.getAddress(), -ethers.parseEther("31.25"));

        const tx2 = masternodeContract.connect(addr2).claimRewards();

        await expect(tx2).not.to.be.reverted;

        await expect(tx2).to.changeEtherBalance(addr2, ethers.parseEther("18.75"));
        await expect(tx2).to.changeEtherBalance(await masternodeContract.getAddress(), -ethers.parseEther("18.75"));
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
            mine(84000 - 2);

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
            
            mine(84000);

            await expect(
                masternodeContract.connect(addr1).completeWithdrawal()
                ).not.to.be.reverted;
        });
    });
});