import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { ethers } from 'hardhat';
import { BucketAuction } from '../typechain-types';

chai.use(chaiAsPromised);

const ONE_ETH = '0xDE0B6B3A7640000';

describe('BucketAuction', function () {
  let ba: BucketAuction;
  let ownerConn: BucketAuction;
  let readonlyConn: BucketAuction;
  let owner: SignerWithAddress;
  let readonly: SignerWithAddress;
  let auctionStartTimestamp = 0;
  let auctionEndTimestamp = 1;

  beforeEach(async () => {
    [owner, readonly] = await ethers.getSigners();

    const BA = await ethers.getContractFactory('BucketAuction');
    ba = await BA.deploy(
      'Test',
      'TEST',
      '',
      /* maxMintableSupply= */ 1000,
      /* globalWalletLimit= */ 0,
      ethers.constants.AddressZero,
      /* minimumContributionInWei= */ 100,
      0, // Placeholder; startTimeUnixSeconds will be overwritten later
      1, // Placeholder; endTimeUnixSeconds will be overwritten later
      owner.address,
    );
    await ba.deployed();

    ownerConn = ba.connect(owner);
    await ownerConn.setTimestampExpirySeconds(60);
    await ownerConn.setStages([
      {
        price: ethers.utils.parseEther('0.1'),
        mintFee: 0,
        walletLimit: 0,
        merkleRoot: ethers.utils.hexZeroPad('0x0', 32),
        maxStageSupply: 100,
        startTimeUnixSeconds: 0,
        endTimeUnixSeconds: 1,
      },
      {
        price: ethers.utils.parseEther('0.2'),
        mintFee: 0,
        walletLimit: 0,
        merkleRoot: ethers.utils.hexZeroPad('0x0', 32),
        maxStageSupply: 100,
        startTimeUnixSeconds: 61,
        endTimeUnixSeconds: 62,
      },
    ]);
    // Get an estimated stage start time
    const block = await ethers.provider.getBlock(
      await ethers.provider.getBlockNumber(),
    );
    // Set the start and end timestamps for the bucket Auction
    auctionStartTimestamp = block.timestamp + 100;
    auctionEndTimestamp = block.timestamp + 200;
    ownerConn.setStartAndEndTimeUnixSeconds(
      auctionStartTimestamp,
      auctionEndTimestamp,
    );

    readonlyConn = ba.connect(readonly);
  });

  it('Getters/Setters of the auction start and end timestamps ', async () => {
    // Set the auction start time
    expect(await readonlyConn.getStartTimeUnixSecods()).to.be.equal(
      auctionStartTimestamp,
    );
    // Set the auction end time
    expect(await readonlyConn.getEndTimeUnixSecods()).to.be.equal(
      auctionEndTimestamp,
    );
    // It should be reverted if start and end times are equal
    await expect(
      ownerConn.setStartAndEndTimeUnixSeconds(
        auctionStartTimestamp,
        auctionStartTimestamp,
      ),
    ).to.be.revertedWith('InvalidStartAndEndTimestamp');
    // It should be reverted if start is bigger than the end time
    await expect(
      ownerConn.setStartAndEndTimeUnixSeconds(
        auctionStartTimestamp,
        auctionStartTimestamp - 1,
      ),
    ).to.be.revertedWith('InvalidStartAndEndTimestamp');
    // Set both start and end times together
    await ownerConn.setStartAndEndTimeUnixSeconds(
      auctionStartTimestamp - 100,
      auctionEndTimestamp - 100,
    );
    // Verify the start and end times were updated properly
    expect(await readonlyConn.getStartTimeUnixSecods()).to.be.equal(
      auctionStartTimestamp - 100,
    );
    expect(await readonlyConn.getEndTimeUnixSecods()).to.be.equal(
      auctionEndTimestamp - 100,
    );
    // Active auction by setting the block.timestamp to the start time of the auction
    await ethers.provider.send('evm_mine', [auctionStartTimestamp]);
    // Set the price so that the subsequent time setters would fail
    await ownerConn.setPrice(100);
    // Set the price so that the subsequent setters would fail
    await expect(
      ownerConn.setStartAndEndTimeUnixSeconds(
        auctionStartTimestamp + 100,
        auctionEndTimestamp + 100,
      ),
    ).to.be.revertedWith('PriceHasBeenSet');
  });

  it('Auction is Active/Inactive according to the current time', async () => {
    // Inactive before the start time of the auction
    await ethers.provider.send('evm_mine', [auctionStartTimestamp - 10]);
    // starts as Inactive
    expect(await ownerConn.getAuctionActive()).to.be.false;

    // Active after the start time of the auction
    await ethers.provider.send('evm_mine', [auctionStartTimestamp]);
    expect(await ownerConn.getAuctionActive()).to.be.true;

    // Inactive after the end time of the auction
    await ethers.provider.send('evm_mine', [auctionEndTimestamp]);
    expect(await ownerConn.getAuctionActive()).to.be.false;
  });

  describe('Bidding', function () {
    it('Reverts if the active stage is not a BucketAuction', async () => {
      // if the current active stage is not a bucket auction; revert with InvalidStage
      await expect(readonlyConn.bid()).to.be.revertedWith(
        'BucketAuctionNotActive',
      );
    });

    it('Reverts if auction not active', async () => {
      // it starts as Inactive, so we cannot make bids
      await expect(readonlyConn.bid()).to.be.revertedWith(
        'BucketAuctionNotActive',
      );
    });

    it('Reverts if bid under minimum', async () => {
      // Active auction by setting the block.timestamp to the start time of the auction
      await ethers.provider.send('evm_mine', [auctionStartTimestamp]);
      // we cannot bid under the minimum
      await expect(readonlyConn.bid({ value: 10 })).to.be.revertedWith(
        'LowerThanMinBidAmount',
      );
    });

    it('Can make bids', async () => {
      // Active auction by setting the block.timestamp to the start time of the auction
      await ethers.provider.send('evm_mine', [auctionStartTimestamp]);
      await expect(readonlyConn.bid({ value: 100 })).to.emit(
        readonlyConn,
        'Bid',
      );
      let userData = await readonlyConn.getUserData(readonly.address);
      expect(userData.contribution).to.eq(100);
      expect(userData.tokensClaimed).to.eq(0);
      expect(userData.refundClaimed).to.eq(false);

      // we let the readonly user bid again
      await readonlyConn.bid({ value: 100 });
      userData = await readonlyConn.getUserData(readonly.address);
      expect(userData.contribution).to.eq(200);
      expect(userData.tokensClaimed).to.eq(0);
      expect(userData.refundClaimed).to.eq(false);
    });

    it('Revert if bid when collection is mintable', async () => {
      // Active auction by setting the block.timestamp to the start time of the auction
      await ethers.provider.send('evm_mine', [auctionStartTimestamp]);
      // we cannot make bids when colleciton is mintable in the ERC721M stages
      await ownerConn.setMintable(true);
      await expect(readonlyConn.bid({ value: 100 })).to.emit(
        readonlyConn,
        'Bid',
      );
    });

    it('Can fetch pages of bids', async () => {
      const bidders = await ethers.getSigners();
      await ethers.provider.send('evm_mine', [auctionStartTimestamp]);

      await Promise.all(
        bidders.map((bidder, i) => ba.connect(bidder).bid({ value: 100 + i })),
      );

      expect(await readonlyConn.getTotalUsers()).to.eq(20);

      const checkPage = async (limit: number, offset: number) => {
        const [userDatas, addresses, total] =
          await readonlyConn.getUserDataPage(limit, offset);
        expect(total).to.eq(20);
        expect(userDatas.length).to.eq(limit);
        expect(addresses.length).to.eq(limit);
        for (let i = 0; i < limit; i += 1) {
          const data = userDatas[i];
          const user = addresses[i];
          expect(data.contribution).to.eq(100 + offset + i);
          const userData = await readonlyConn.getUserData(user);
          expect(userData.contribution).to.eq(data.contribution);
        }

        return {
          userDatas,
          addresses,
        };
      };

      const paginatedUserData = [];
      const paginatedAddresses: string[] = [];
      for (let i = 0; i < 20; i += 5) {
        const { userDatas, addresses } = await checkPage(5, i);
        paginatedUserData.push(...userDatas);
        paginatedAddresses.push(...addresses);
      }

      const { userDatas, addresses } = await checkPage(20, 0);
      expect(paginatedUserData).to.deep.eq(userDatas);
      expect(paginatedAddresses).to.deep.eq(addresses);
    });

    it('getUserDataPage truncates page if limit + offset would exceed _users.length', async () => {
      const bidders = await ethers.getSigners();
      await ethers.provider.send('evm_mine', [auctionStartTimestamp]);

      await Promise.all(
        bidders.map((bidder, i) => ba.connect(bidder).bid({ value: 100 + i })),
      );

      expect(await readonlyConn.getTotalUsers()).to.eq(20);

      // 20 total, so requesting 10 items at offset 15 should return just 5
      const [userDatas, addresses, total] = await readonlyConn.getUserDataPage(
        10,
        15,
      );
      expect(userDatas.length).to.eq(5);
      expect(addresses.length).to.eq(5);
      expect(total).to.eq(20);
    });
  });

  it('Can set minimum contribution', async () => {
    expect(await ownerConn.getMinimumContributionInWei()).to.be.equal(100);
    await expect(ownerConn.setMinimumContribution(999)).to.emit(
      ownerConn,
      'SetMinimumContribution',
    );
    expect(await readonlyConn.getMinimumContributionInWei()).to.be.equal(999);
    await expect(readonlyConn.setMinimumContribution(1999)).to.be.revertedWith(
      'Ownable',
    );
  });

  it('Can set price', async () => {
    // Setup the test context: block.timestamp should comply to the stage being active
    await ethers.provider.send('evm_mine', [auctionStartTimestamp]);
    // If the auction is active, then we cannot set price.
    await expect(ownerConn.setPrice(200)).to.be.revertedWith(
      'BucketAuctionActive',
    );

    // Setup the test context: block.timestamp should comply to the stage being active
    await ethers.provider.send('evm_mine', [auctionEndTimestamp]);

    // If claimable, then we cannot set price.
    await ownerConn.setClaimable(true);
    await expect(ownerConn.setPrice(200)).to.be.revertedWith(
      'CannotSetPriceIfClaimable',
    );
    // Clean up
    await ownerConn.setClaimable(false);

    // If can mint, we should still be able to set price.
    await ownerConn.setMintable(true);
    await expect(ownerConn.setPrice(100)).to.emit(ownerConn, 'SetPrice');
    await expect(await readonlyConn.getPrice()).to.be.equal(100);
    // Clean up
    await ownerConn.setMintable(false);

    await expect(ownerConn.setPrice(200)).to.emit(ownerConn, 'SetPrice');
    expect(await readonlyConn.getPrice()).to.be.equal(200);
    await expect(readonlyConn.setPrice(200)).to.be.revertedWith('Ownable');
  });

  it('Can set claimable', async () => {
    expect(await ownerConn.getClaimable()).to.be.equal(false);

    // Only owner can set claimable
    await expect(readonlyConn.setClaimable(true)).to.be.revertedWith('Ownable');

    await ownerConn.setClaimable(true);
    expect(await ownerConn.getClaimable()).to.be.equal(true);
  });

  describe('Bucket auction calculation', function () {
    const runs = [
      { bids: [100], price: 100, refund: 0, numTokens: 1 },
      { bids: [100, 1], price: 100, refund: 1, numTokens: 1 },
      { bids: [100, 11, 88], price: 100, refund: 99, numTokens: 1 },
      { bids: [100, 100], price: 100, refund: 0, numTokens: 2 },
      { bids: [100], price: 99, refund: 1, numTokens: 1 },
      { bids: [100], price: 101, refund: 100, numTokens: 0 },
    ];

    runs.forEach((run) => {
      it(`Bid: ${run.bids}, price: ${run.price}`, async () => {
        // Active auction by setting the block.timestamp to the start time of the auction
        await ethers.provider.send('evm_mine', [auctionStartTimestamp]);

        for (const bid of run.bids) {
          await expect(readonlyConn.bid({ value: bid })).to.emit(
            readonlyConn,
            'Bid',
          );
        }

        const contribution = run.bids.reduce((a, b) => a + b, 0);
        let balance = (
          await ownerConn.provider.getBalance(ownerConn.address)
        ).toNumber();
        expect(balance).to.eq(contribution);

        // Inactive auction by setting the block.timestamp to the end time of the auction
        await ethers.provider.send('evm_mine', [auctionEndTimestamp]);
        await ownerConn.setPrice(run.price);
        await ownerConn.setClaimable(true);

        expect(
          await readonlyConn.amountPurchased(readonly.address),
        ).to.be.equal(run.numTokens);
        expect(await readonlyConn.refundAmount(readonly.address)).to.be.equal(
          run.refund,
        );

        await readonlyConn.claimTokensAndRefund();
        const userData = await readonlyConn.getUserData(readonly.address);
        expect(userData.contribution).to.eq(contribution);
        expect(userData.tokensClaimed).to.eq(run.numTokens);
        expect(userData.refundClaimed).to.eq(true);

        balance = (
          await ownerConn.provider.getBalance(ownerConn.address)
        ).toNumber();
        expect(balance).to.eq(run.price * run.numTokens);
      });
    });
  });

  describe('User claim and refund', function () {
    it('user claimTokensAndRefund', async () => {
      // Active auction by setting the block.timestamp to the start time of the auction
      await ethers.provider.send('evm_mine', [auctionStartTimestamp]);
      // we can make bids
      let balance = (
        await ownerConn.provider.getBalance(ownerConn.address)
      ).toNumber();
      expect(balance).to.eq(0);
      await expect(readonlyConn.bid({ value: 100 })).to.emit(
        readonlyConn,
        'Bid',
      );

      balance = (
        await ownerConn.provider.getBalance(ownerConn.address)
      ).toNumber();
      expect(balance).to.eq(100);

      // Inactive auction by setting the block.timestamp to the end time of the auction
      await ethers.provider.send('evm_mine', [auctionEndTimestamp]);
      // and then we prepare to close the auction and settle the price and refund
      await ownerConn.setPrice(80);

      expect(await ownerConn.getClaimable()).to.be.false;
      await ownerConn.setClaimable(true);
      expect(await ownerConn.getClaimable()).to.be.true;

      await expect(readonlyConn.claimTokensAndRefund()).to.emit(
        readonlyConn,
        'Transfer',
      );
      const userData = await readonlyConn.getUserData(readonly.address);
      expect(userData.contribution).to.eq(100);
      expect(userData.tokensClaimed).to.eq(1);
      expect(userData.refundClaimed).to.eq(true);
      balance = (
        await ownerConn.provider.getBalance(ownerConn.address)
      ).toNumber();
      expect(balance).to.eq(80);

      // we cannot claim again after the first successful claim
      await expect(readonlyConn.claimTokensAndRefund()).to.be.revertedWith(
        'UserAlreadyClaimed',
      );

      // withdraw
      await expect(ownerConn.withdraw()).to.emit(ownerConn, 'Withdraw');
      balance = (
        await ownerConn.provider.getBalance(ownerConn.address)
      ).toNumber();
      expect(balance).to.eq(0);
    });

    it('user without bidding claimTokensAndRefund', async () => {
      // Inactive auction by setting the block.timestamp to the end time of the auction
      await ethers.provider.send('evm_mine', [auctionEndTimestamp]);
      await ownerConn.setPrice(80);
      await ownerConn.setClaimable(true);

      await expect(readonlyConn.claimTokensAndRefund()).to.not.emit(
        readonlyConn,
        'Transfer',
      );
      const userData = await readonlyConn.getUserData(readonly.address);
      expect(userData.contribution).to.eq(0);
      expect(userData.tokensClaimed).to.eq(0);
      expect(userData.refundClaimed).to.eq(true);
    });

    it('Reverts if price not set', async () => {
      // Active auction by setting the block.timestamp to the start time of the auction
      await ethers.provider.send('evm_mine', [auctionStartTimestamp]);
      await expect(readonlyConn.bid({ value: 100 })).to.emit(
        readonlyConn,
        'Bid',
      );

      // Inactive auction by setting the block.timestamp to the end time of the auction
      await ethers.provider.send('evm_mine', [auctionEndTimestamp]);
      await ownerConn.setClaimable(true);

      await expect(readonlyConn.claimTokensAndRefund()).to.be.revertedWith(
        'PriceNotSet',
      );
    });

    it('Reverts if not claimable', async () => {
      // Active auction by setting the block.timestamp to the start time of the auction
      await ethers.provider.send('evm_mine', [auctionStartTimestamp]);
      await expect(readonlyConn.bid({ value: 100 })).to.emit(
        readonlyConn,
        'Bid',
      );

      // Inactive auction by setting the block.timestamp to the end time of the auction
      await ethers.provider.send('evm_mine', [auctionEndTimestamp]);
      await ownerConn.setPrice(100);

      await expect(readonlyConn.claimTokensAndRefund()).to.be.revertedWith(
        'NotClaimable',
      );
    });

    it('Reverts if not enough supply', async () => {
      // Active auction by setting the block.timestamp to the start time of the auction
      await ethers.provider.send('evm_mine', [auctionStartTimestamp]);

      await expect(readonlyConn.bid({ value: 1001 })).to.emit(
        readonlyConn,
        'Bid',
      );

      // Inactive auction by setting the block.timestamp to the end time of the auction
      await ethers.provider.send('evm_mine', [auctionEndTimestamp]);
      // Expected tokens is 1001 which exceeds max mintbale supply = 1000.
      await ownerConn.setPrice(1);
      await ownerConn.setClaimable(true);

      await expect(readonlyConn.claimTokensAndRefund()).to.be.revertedWith(
        'NoSupplyLeft',
      );
    });

    it('Can NOT set price if the first token already sent', async () => {
      // Active auction by setting the block.timestamp to the start time of the auction
      await ethers.provider.send('evm_mine', [auctionStartTimestamp]);

      await expect(readonlyConn.bid({ value: 100 })).to.emit(
        readonlyConn,
        'Bid',
      );

      // Inactive auction by setting the block.timestamp to the end time of the auction
      await ethers.provider.send('evm_mine', [auctionEndTimestamp]);
      await ownerConn.setPrice(1);

      // Send tokens
      await expect(ownerConn.sendTokens(readonly.address, 1)).to.emit(
        readonlyConn,
        'Transfer',
      );

      // Should be reverted when re-setting the price if
      //  it is not claimable but the first token is already sent
      await ownerConn.setClaimable(false);
      await expect(ownerConn.setPrice(1)).to.be.revertedWith(
        'CannotSetPriceIfFirstTokenSent',
      );
    });

    it('Reverts if token already sent or refund already claimed', async () => {
      // Active auction by setting the block.timestamp to the start time of the auction
      await ethers.provider.send('evm_mine', [auctionStartTimestamp]);

      await expect(readonlyConn.bid({ value: 100 })).to.emit(
        readonlyConn,
        'Bid',
      );

      // Inactive auction by setting the block.timestamp to the end time of the auction
      await ethers.provider.send('evm_mine', [auctionEndTimestamp]);
      await ownerConn.setPrice(1);
      await ownerConn.setClaimable(true);

      // Send tokens
      await expect(ownerConn.sendTokens(readonly.address, 1)).to.emit(
        readonlyConn,
        'Transfer',
      );

      let userData = await readonlyConn.getUserData(readonly.address);
      expect(userData.contribution).to.eq(100);
      expect(userData.tokensClaimed).to.eq(1);
      expect(userData.refundClaimed).to.eq(false);

      // Try to re-send tokens and the refund and expect a revert with AlreadySentTokensToUser
      await expect(
        ownerConn.sendTokensAndRefund(readonly.address),
      ).to.be.revertedWith('AlreadySentTokensToUser');

      // Issue refund
      await ownerConn.sendRefund(readonly.address);
      userData = await readonlyConn.getUserData(readonly.address);
      expect(userData.contribution).to.eq(100);
      expect(userData.tokensClaimed).to.eq(1);
      expect(userData.refundClaimed).to.eq(true);

      // Try to re-issue the refund and expect a revert with UserAlreadyClaimed
      await expect(ownerConn.sendRefund(readonly.address)).to.be.revertedWith(
        'UserAlreadyClaimed',
      );
    });

    it('Reverts if refund transfer fails', async () => {
      // TODO: set up a custom contract that refuses transfer.
    });
  });

  describe('Owner send tokens and refund', function () {
    it('sendTokensAndRefund', async () => {
      // Active auction by setting the block.timestamp to the start time of the auction
      await ethers.provider.send('evm_mine', [auctionStartTimestamp]);

      let balance = (
        await ownerConn.provider.getBalance(ownerConn.address)
      ).toNumber();
      expect(balance).to.eq(0);

      await expect(readonlyConn.bid({ value: 100 })).to.emit(
        readonlyConn,
        'Bid',
      );

      balance = (
        await ownerConn.provider.getBalance(ownerConn.address)
      ).toNumber();
      expect(balance).to.eq(100);

      // Inactive auction by setting the block.timestamp to the end time of the auction
      await ethers.provider.send('evm_mine', [auctionEndTimestamp]);
      await ownerConn.setPrice(20);
      await ownerConn.setClaimable(true);

      await expect(ownerConn.sendTokensAndRefund(readonly.address)).to.emit(
        readonlyConn,
        'Transfer',
      );
      const userData = await readonlyConn.getUserData(readonly.address);
      expect(userData.contribution).to.eq(100);
      expect(userData.tokensClaimed).to.eq(5);
      expect(userData.refundClaimed).to.eq(true);
      balance = (
        await ownerConn.provider.getBalance(ownerConn.address)
      ).toNumber();
      expect(balance).to.eq(100);

      // user cannot claim again
      await expect(readonlyConn.claimTokensAndRefund()).to.be.revertedWith(
        'UserAlreadyClaimed',
      );

      // owner cannot send tokens and refund again
      await expect(
        ownerConn.sendTokensAndRefund(readonly.address),
      ).to.be.revertedWith('UserAlreadyClaimed');
    });

    // Two bidders.
    it('sendTokensAndRefundBatch', async () => {
      // Active auction by setting the block.timestamp to the start time of the auction
      await ethers.provider.send('evm_mine', [auctionStartTimestamp]);
      const readonly2 = await ethers.getImpersonatedSigner(
        '0xef59F379B48f2E92aBD94ADcBf714D170967925D',
      );
      const readonly2Address = await readonly2.getAddress();
      const readonlyConn2 = ba.connect(readonly2);

      // Fund reader2 for testing (reader is already funded).
      await ethers.provider.send('hardhat_setBalance', [
        readonly2Address,
        ONE_ETH,
      ]);

      let balance = (
        await ownerConn.provider.getBalance(ownerConn.address)
      ).toNumber();
      expect(balance).to.eq(0);

      await expect(readonlyConn.bid({ value: 100 })).to.emit(
        readonlyConn,
        'Bid',
      );
      await expect(readonlyConn2.bid({ value: 200 })).to.emit(
        readonlyConn2,
        'Bid',
      );

      balance = (
        await ownerConn.provider.getBalance(ownerConn.address)
      ).toNumber();
      expect(balance).to.eq(300);

      // Inactive auction by setting the block.timestamp to the end time of the auction
      await ethers.provider.send('evm_mine', [auctionEndTimestamp]);
      await ownerConn.setPrice(110);
      await ownerConn.setClaimable(true);

      await ownerConn.sendTokensAndRefundBatch([
        readonly.address,
        readonly2.address,
      ]);

      const userData1 = await readonlyConn.getUserData(readonly.address);
      expect(userData1.contribution).to.eq(100);
      expect(userData1.tokensClaimed).to.eq(0);
      expect(userData1.refundClaimed).to.eq(true);

      const userData2 = await readonlyConn.getUserData(readonly2.address);
      expect(userData2.contribution).to.eq(200);
      expect(userData2.tokensClaimed).to.eq(1);
      expect(userData2.refundClaimed).to.eq(true);

      balance = (
        await ownerConn.provider.getBalance(ownerConn.address)
      ).toNumber();
      expect(balance).to.eq(110);
    });

    it('sendTokens & sendRefund', async () => {
      // Active auction by setting the block.timestamp to the start time of the auction
      await ethers.provider.send('evm_mine', [auctionStartTimestamp]);

      await expect(readonlyConn.bid({ value: 100 })).to.emit(
        readonlyConn,
        'Bid',
      );

      // Inactive auction by setting the block.timestamp to the end time of the auction
      await ethers.provider.send('evm_mine', [auctionEndTimestamp]);
      await ownerConn.setPrice(20);
      await ownerConn.setClaimable(true);

      // Send tokens
      await expect(ownerConn.sendTokens(readonly.address, 2)).to.emit(
        readonlyConn,
        'Transfer',
      );
      await expect(ownerConn.sendTokens(readonly.address, 3)).to.emit(
        readonlyConn,
        'Transfer',
      );
      await expect(
        ownerConn.sendTokens(readonly.address, 1),
      ).to.be.revertedWith('CannotSendMoreThanUserPurchased');

      let userData = await readonlyConn.getUserData(readonly.address);
      expect(userData.contribution).to.eq(100);
      expect(userData.tokensClaimed).to.eq(5);
      expect(userData.refundClaimed).to.eq(false);

      // Issue refund
      await ownerConn.sendRefund(readonly.address);
      userData = await readonlyConn.getUserData(readonly.address);
      expect(userData.contribution).to.eq(100);
      expect(userData.tokensClaimed).to.eq(5);
      expect(userData.refundClaimed).to.eq(true);
    });

    it('sendTokensBatch & sendRefundBatch', async () => {
      // Active auction by setting the block.timestamp to the start time of the auction
      await ethers.provider.send('evm_mine', [auctionStartTimestamp]);
      const readonly2 = await ethers.getImpersonatedSigner(
        '0xef59F379B48f2E92aBD94ADcBf714D170967925D',
      );
      const readonly2Address = await readonly2.getAddress();
      const readonlyConn2 = ba.connect(readonly2);

      // Fund reader2 for testing (reader is already funded)
      await ethers.provider.send('hardhat_setBalance', [
        readonly2Address,
        ONE_ETH,
      ]);

      const balance = (
        await ownerConn.provider.getBalance(ownerConn.address)
      ).toNumber();
      expect(balance).to.eq(0);

      await expect(readonlyConn.bid({ value: 100 })).to.emit(
        readonlyConn,
        'Bid',
      );
      await expect(readonlyConn2.bid({ value: 200 })).to.emit(
        readonlyConn2,
        'Bid',
      );

      // Inactive auction by setting the block.timestamp to the end time of the auction
      await ethers.provider.send('evm_mine', [auctionEndTimestamp]);
      await ownerConn.setPrice(30);
      await ownerConn.setClaimable(true);

      // Issue refund
      await ownerConn.sendRefundBatch([readonly.address, readonly2.address]);

      let userData1 = await readonlyConn.getUserData(readonly.address);
      expect(userData1.contribution).to.eq(100);
      expect(userData1.tokensClaimed).to.eq(0);
      expect(userData1.refundClaimed).to.eq(true);

      let userData2 = await readonlyConn2.getUserData(readonly2.address);
      expect(userData2.contribution).to.eq(200);
      expect(userData2.tokensClaimed).to.eq(0);
      expect(userData2.refundClaimed).to.eq(true);

      // Send tokens
      await ownerConn.sendTokensBatch([readonly.address, readonly2.address]);

      userData1 = await readonlyConn.getUserData(readonly.address);
      expect(userData1.contribution).to.eq(100);
      expect(userData1.tokensClaimed).to.eq(3);
      expect(userData1.refundClaimed).to.eq(true);

      userData2 = await readonlyConn2.getUserData(readonly2.address);
      expect(userData2.contribution).to.eq(200);
      expect(userData2.tokensClaimed).to.eq(6);
      expect(userData2.refundClaimed).to.eq(true);
    });

    it('sendAllTokens', async () => {
      // Active auction by setting the block.timestamp to the start time of the auction
      await ethers.provider.send('evm_mine', [auctionStartTimestamp]);

      await expect(readonlyConn.bid({ value: 100 })).to.emit(
        readonlyConn,
        'Bid',
      );

      // Inactive auction by setting the block.timestamp to the end time of the auction
      await ethers.provider.send('evm_mine', [auctionEndTimestamp]);
      await ownerConn.setPrice(20);
      await ownerConn.setClaimable(true);

      await expect(ownerConn.sendAllTokens(readonly.address)).to.emit(
        readonlyConn,
        'Transfer',
      );

      const userData = await readonlyConn.getUserData(readonly.address);
      expect(userData.contribution).to.eq(100);
      expect(userData.tokensClaimed).to.eq(5);
      expect(userData.refundClaimed).to.eq(false);
    });

    it('Reverts if not owner', async () => {
      await expect(
        readonlyConn.sendTokens(readonly.address, 1),
      ).to.be.revertedWith('Ownable');
      await expect(
        readonlyConn.sendRefund(readonly.address),
      ).to.be.revertedWith('Ownable');
      await expect(
        readonlyConn.sendAllTokens(readonly.address),
      ).to.be.revertedWith('Ownable');
      await expect(
        readonlyConn.sendTokensBatch([readonly.address]),
      ).to.be.revertedWith('Ownable');
      await expect(
        readonlyConn.sendRefundBatch([readonly.address]),
      ).to.be.revertedWith('Ownable');
      await expect(
        readonlyConn.sendTokensAndRefund(readonly.address),
      ).to.be.revertedWith('Ownable');
      await expect(
        readonlyConn.sendTokensAndRefundBatch([readonly.address]),
      ).to.be.revertedWith('Ownable');
    });

    it('Reverts if price not set', async () => {
      await expect(
        ownerConn.amountPurchased(readonly.address),
      ).to.be.revertedWith('PriceNotSet');
      await expect(ownerConn.refundAmount(readonly.address)).to.be.revertedWith(
        'PriceNotSet',
      );
      await expect(
        ownerConn.sendTokens(readonly.address, 1),
      ).to.be.revertedWith('PriceNotSet');
      await expect(ownerConn.sendRefund(readonly.address)).to.be.revertedWith(
        'PriceNotSet',
      );
      await expect(
        ownerConn.sendAllTokens(readonly.address),
      ).to.be.revertedWith('PriceNotSet');
      await expect(
        ownerConn.sendTokensBatch([readonly.address]),
      ).to.be.revertedWith('PriceNotSet');
      await expect(
        ownerConn.sendRefundBatch([readonly.address]),
      ).to.be.revertedWith('PriceNotSet');
      await expect(
        ownerConn.sendTokensAndRefund(readonly.address),
      ).to.be.revertedWith('PriceNotSet');
      await expect(
        ownerConn.sendTokensAndRefundBatch([readonly.address]),
      ).to.be.revertedWith('PriceNotSet');
    });
  });
});
