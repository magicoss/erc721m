import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';

describe('ERC721MPausableOperatorFilterer', function () {
  let erc721MPausableOperatorFilterer: Contract;
  let owner: any;
  let receiver: any;

  beforeEach(async function () {
    const ERC721MPausableOperatorFiltererFactory =
      await ethers.getContractFactory('ERC721MPausableOperatorFilterer');
    [owner, receiver] = await ethers.getSigners();

    erc721MPausableOperatorFilterer =
      await ERC721MPausableOperatorFiltererFactory.deploy(
        'test',
        'TEST',
        '.json',
        1000,
        0,
        ethers.constants.AddressZero,
        300,
        ethers.constants.AddressZero,
      );
    erc721MPausableOperatorFilterer =
      erc721MPausableOperatorFilterer.connect(owner);
    await erc721MPausableOperatorFilterer.deployed();

    const block = await ethers.provider.getBlock(
      await ethers.provider.getBlockNumber(),
    );
    // +10 is a number bigger than the count of transactions up to mint
    const stageStart = block.timestamp + 10;
    // Set stages
    await erc721MPausableOperatorFilterer.setStages([
      {
        price: ethers.utils.parseEther('0.5'),
        mintFee: 0,
        walletLimit: 0,
        merkleRoot: ethers.utils.hexZeroPad('0x0', 32),
        maxStageSupply: 5,
        startTimeUnixSeconds: stageStart,
        endTimeUnixSeconds: stageStart + 10000,
      },
    ]);
    await erc721MPausableOperatorFilterer.setMintable(true);
    // Setup the test context: Update block.timestamp to comply to the stage being active
    await ethers.provider.send('evm_mine', [stageStart - 1]);
  });

  it('should revert if non-owner tries to pause/unpause', async function () {
    await expect(
      erc721MPausableOperatorFilterer.connect(receiver).pause(),
    ).to.be.revertedWith('Ownable: caller is not the owner');
    await expect(
      erc721MPausableOperatorFilterer.connect(receiver).unpause(),
    ).to.be.revertedWith('Ownable: caller is not the owner');
  });

  describe('Test transfers when paused/unpaused', function () {
    beforeEach(async function () {
      const qty = 2;
      const proof = [ethers.utils.hexZeroPad('0x', 32)]; // Placeholder
      const timestamp = 0;
      const signature = '0x00'; // Placeholder

      await erc721MPausableOperatorFilterer.mint(
        qty,
        proof,
        timestamp,
        signature,
        {
          value: ethers.utils.parseEther('50'),
        },
      );
    });

    it('should revert transfers when paused', async function () {
      await erc721MPausableOperatorFilterer.pause();
      await expect(
        erc721MPausableOperatorFilterer.transferFrom(
          owner.address,
          receiver.address,
          0,
        ),
      ).to.be.revertedWith('Pausable: paused');
    });

    it('should allow transfers when not paused and approved', async function () {
      await erc721MPausableOperatorFilterer.transferFrom(
        owner.address,
        receiver.address,
        0,
      );
      expect(await erc721MPausableOperatorFilterer.ownerOf(0)).to.equal(
        receiver.address,
      );
    });

    it('should revert safe transfers when paused', async function () {
      await erc721MPausableOperatorFilterer.pause();

      await expect(
        erc721MPausableOperatorFilterer[
          'safeTransferFrom(address,address,uint256)'
        ](owner.address, receiver.address, 0),
      ).to.be.revertedWith('Pausable: paused');
      await expect(
        erc721MPausableOperatorFilterer[
          'safeTransferFrom(address,address,uint256,bytes)'
        ](owner.address, receiver.address, 0, []),
      ).to.be.revertedWith('Pausable: paused');
    });

    it('should allow safe transfers when not paused and approved', async function () {
      await erc721MPausableOperatorFilterer[
        'safeTransferFrom(address,address,uint256)'
      ](owner.address, receiver.address, 0);
      expect(await erc721MPausableOperatorFilterer.ownerOf(0)).to.equal(
        receiver.address,
      );

      await erc721MPausableOperatorFilterer[
        'safeTransferFrom(address,address,uint256,bytes)'
      ](owner.address, receiver.address, 1, []);
      expect(await erc721MPausableOperatorFilterer.ownerOf(1)).to.equal(
        receiver.address,
      );
    });
  });

  describe('Test other actions when paused/unpaused', function () {
    it('should allow minting when paused', async function () {
      const qty = 1;
      const proof = [ethers.utils.hexZeroPad('0x', 32)]; // Placeholder
      const timestamp = 0;
      const signature = '0x00'; // Placeholder
      await erc721MPausableOperatorFilterer.pause();
      await erc721MPausableOperatorFilterer.mint(
        qty,
        proof,
        timestamp,
        signature,
        {
          value: ethers.utils.parseEther('50'),
        },
      );

      expect(await erc721MPausableOperatorFilterer.ownerOf(0)).to.equal(
        owner.address,
      );
    });

    it('should allow minting when unpaused', async function () {
      const qty = 1;
      const proof = [ethers.utils.hexZeroPad('0x', 32)]; // Placeholder
      const timestamp = 0;
      const signature = '0x00'; // Placeholder
      await erc721MPausableOperatorFilterer.pause();
      await erc721MPausableOperatorFilterer.unpause();
      await erc721MPausableOperatorFilterer.mint(
        qty,
        proof,
        timestamp,
        signature,
        {
          value: ethers.utils.parseEther('50'),
        },
      );

      expect(await erc721MPausableOperatorFilterer.ownerOf(0)).to.equal(
        owner.address,
      );
    });
  });
});
