import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import chai, { assert, expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { ethers } from 'hardhat';
import { MerkleTree } from 'merkletreejs';
import { ERC721CMRoyaltiesInitializable, ERC721CMRoyaltiesCloneFactory } from '../typechain-types';

const { keccak256, getAddress } = ethers.utils;

chai.use(chaiAsPromised);

const ONE_HUNDRED_ETH = '0x56BC75E2D63100000';
const WALLET_1 = '0x0764844ac95ABCa4F6306E592c7D9C9f3615f590';
const WALLET_2 = '0xef59F379B48f2E92aBD94ADcBf714D170967925D';

describe('ERC721CMIRoyaltiesClone', function () {
  let cloneFactory: ERC721CMRoyaltiesCloneFactory;
  let contract: ERC721CMRoyaltiesInitializable;
  let readonlyContract: ERC721CMRoyaltiesInitializable;
  let owner: SignerWithAddress;
  let readonly: SignerWithAddress;
  let fundReceiver: SignerWithAddress;
  let chainId: number;

  this.beforeAll(async () => {
    const contractFactory =
        await ethers.getContractFactory('ERC721CMRoyaltiesCloneFactory');
    cloneFactory = await contractFactory.deploy();
    await cloneFactory.deployed();
  })

  beforeEach(async () => {
    [owner, readonly, fundReceiver] = await ethers.getSigners();
    cloneFactory = cloneFactory.connect(owner);

    const tx = await cloneFactory.create(
      'TestCollection',
      'TestSymbol',
      '.json',
      1000,
      0,
      60,
      '0x0000000000000000000000000000000000000000',
      await fundReceiver.getAddress(),
      WALLET_1,
      10,
      );
    
    const receipt = await tx.wait();
    const event = receipt.events!.find(event => event.event === 'CreateClone')!;
    const cloneAddress = event.args![0];

    const contractFactory =
        await ethers.getContractFactory('ERC721CMRoyaltiesInitializable');
    const erc721Clone = contractFactory.attach(cloneAddress);

    contract = erc721Clone.connect(owner);
    readonlyContract = erc721Clone.connect(readonly);
    chainId = await ethers.provider.getNetwork().then((n) => n.chainId);
  });

  it('Supports the right interfaces', async () => {
    expect(await contract.supportsInterface('0x01ffc9a7')).to.be.true; // IERC165
    expect(await contract.supportsInterface('0x80ac58cd')).to.be.true; // IERC721
    expect(await contract.supportsInterface('0x5b5e139f')).to.be.true; // IERC721Metadata
    expect(await contract.supportsInterface('0x2a55205a')).to.be.true; // IERC2981
  });

  it('Contract can be paused/unpaused', async () => {
    // starts unpaused
    expect(await contract.getMintable()).to.be.true;

    // we should assert that the correct event is emitted
    await expect(contract.setMintable(false))
      .to.emit(contract, 'SetMintable')
      .withArgs(false);
    expect(await contract.getMintable()).to.be.false;

    // readonlyContract should not be able to setMintable
    await expect(readonlyContract.setMintable(true)).to.be.revertedWith(
      'Ownable',
    );
  });

  it('withdraws balance by owner', async () => {
    // Send 100 wei to contract address for testing.
    await ethers.provider.send('hardhat_setBalance', [
      contract.address,
      '0x64', // 100 wei
    ]);
    expect(
      (await contract.provider.getBalance(contract.address)).toNumber(),
    ).to.equal(100);

    await expect(() => contract.withdraw()).to.changeEtherBalances(
      [contract, owner, fundReceiver],
      [-100, 0, 100],
    );

    expect(
      (await contract.provider.getBalance(contract.address)).toNumber(),
    ).to.equal(0);

    // readonlyContract should not be able to withdraw
    await expect(readonlyContract.withdraw()).to.be.revertedWith('Ownable');
  });

  describe('Stages', function () {
    it('cannot set stages with readonly address', async () => {
      await expect(
        readonlyContract.setStages([
          {
            price: ethers.utils.parseEther('0.5'),
            mintFee: 0,
            walletLimit: 3,
            merkleRoot: ethers.utils.hexZeroPad('0x1', 32),
            maxStageSupply: 5,
            startTimeUnixSeconds: 0,
            endTimeUnixSeconds: 1,
          },
          {
            price: ethers.utils.parseEther('0.6'),
            mintFee: 0,
            walletLimit: 4,
            merkleRoot: ethers.utils.hexZeroPad('0x2', 32),
            maxStageSupply: 10,
            startTimeUnixSeconds: 61,
            endTimeUnixSeconds: 62,
          },
        ]),
      ).to.be.revertedWith('Ownable');
    });

    it('cannot set stages with insufficient gap', async () => {
      await expect(
        contract.setStages([
          {
            price: ethers.utils.parseEther('0.5'),
            mintFee: 0,
            walletLimit: 3,
            merkleRoot: ethers.utils.hexZeroPad('0x1', 32),
            maxStageSupply: 5,
            startTimeUnixSeconds: 0,
            endTimeUnixSeconds: 1,
          },
          {
            price: ethers.utils.parseEther('0.6'),
            mintFee: 0,
            walletLimit: 4,
            merkleRoot: ethers.utils.hexZeroPad('0x2', 32),
            maxStageSupply: 10,
            startTimeUnixSeconds: 60,
            endTimeUnixSeconds: 62,
          },
        ]),
      ).to.be.revertedWith('InsufficientStageTimeGap');
    });

    it('cannot set stages due to startTimeUnixSeconds is not smaller than endTimeUnixSeconds', async () => {
      await expect(
        contract.setStages([
          {
            price: ethers.utils.parseEther('0.5'),
            mintFee: 0,
            walletLimit: 3,
            merkleRoot: ethers.utils.hexZeroPad('0x1', 32),
            maxStageSupply: 5,
            startTimeUnixSeconds: 0,
            endTimeUnixSeconds: 0,
          },
          {
            price: ethers.utils.parseEther('0.6'),
            mintFee: 0,
            walletLimit: 4,
            merkleRoot: ethers.utils.hexZeroPad('0x2', 32),
            maxStageSupply: 10,
            startTimeUnixSeconds: 61,
            endTimeUnixSeconds: 61,
          },
        ]),
      ).to.be.revertedWith('InvalidStartAndEndTimestamp');

      await expect(
        contract.setStages([
          {
            price: ethers.utils.parseEther('0.5'),
            mintFee: 0,
            walletLimit: 3,
            merkleRoot: ethers.utils.hexZeroPad('0x1', 32),
            maxStageSupply: 5,
            startTimeUnixSeconds: 1,
            endTimeUnixSeconds: 0,
          },
          {
            price: ethers.utils.parseEther('0.6'),
            mintFee: 0,
            walletLimit: 4,
            merkleRoot: ethers.utils.hexZeroPad('0x2', 32),
            maxStageSupply: 10,
            startTimeUnixSeconds: 62,
            endTimeUnixSeconds: 61,
          },
        ]),
      ).to.be.revertedWith('InvalidStartAndEndTimestamp');
    });

    it('can set / reset stages', async () => {
      await contract.setStages([
        {
          price: ethers.utils.parseEther('0.5'),
          mintFee: 0,
          walletLimit: 3,
          merkleRoot: ethers.utils.hexZeroPad('0x1', 32),
          maxStageSupply: 5,
          startTimeUnixSeconds: 0,
          endTimeUnixSeconds: 1,
        },
        {
          price: ethers.utils.parseEther('0.6'),
          mintFee: 0,
          walletLimit: 4,
          merkleRoot: ethers.utils.hexZeroPad('0x2', 32),
          maxStageSupply: 10,
          startTimeUnixSeconds: 61,
          endTimeUnixSeconds: 62,
        },
      ]);

      expect(await contract.getNumberStages()).to.equal(2);

      let [stageInfo, walletMintedCount] = await contract.getStageInfo(0);
      expect(stageInfo.price).to.equal(ethers.utils.parseEther('0.5'));
      expect(stageInfo.walletLimit).to.equal(3);
      expect(stageInfo.maxStageSupply).to.equal(5);
      expect(stageInfo.merkleRoot).to.equal(ethers.utils.hexZeroPad('0x1', 32));
      expect(walletMintedCount).to.equal(0);

      [stageInfo, walletMintedCount] = await contract.getStageInfo(1);
      expect(stageInfo.price).to.equal(ethers.utils.parseEther('0.6'));
      expect(stageInfo.walletLimit).to.equal(4);
      expect(stageInfo.maxStageSupply).to.equal(10);
      expect(stageInfo.merkleRoot).to.equal(ethers.utils.hexZeroPad('0x2', 32));
      expect(walletMintedCount).to.equal(0);

      // Update to one stage
      await contract.setStages([
        {
          price: ethers.utils.parseEther('0.6'),
          mintFee: 0,
          walletLimit: 4,
          merkleRoot: ethers.utils.hexZeroPad('0x3', 32),
          maxStageSupply: 0,
          startTimeUnixSeconds: 0,
          endTimeUnixSeconds: 1,
        },
      ]);

      expect(await contract.getNumberStages()).to.equal(1);
      [stageInfo, walletMintedCount] = await contract.getStageInfo(0);
      expect(stageInfo.price).to.equal(ethers.utils.parseEther('0.6'));
      expect(stageInfo.walletLimit).to.equal(4);
      expect(stageInfo.maxStageSupply).to.equal(0);
      expect(stageInfo.merkleRoot).to.equal(ethers.utils.hexZeroPad('0x3', 32));
      expect(walletMintedCount).to.equal(0);

      // Add another stage
      await contract.setStages([
        {
          price: ethers.utils.parseEther('0.6'),
          mintFee: 0,
          walletLimit: 4,
          merkleRoot: ethers.utils.hexZeroPad('0x3', 32),
          maxStageSupply: 0,
          startTimeUnixSeconds: 0,
          endTimeUnixSeconds: 1,
        },
        {
          price: ethers.utils.parseEther('0.7'),
          mintFee: 0,
          walletLimit: 5,
          merkleRoot: ethers.utils.hexZeroPad('0x4', 32),
          maxStageSupply: 5,
          startTimeUnixSeconds: 61,
          endTimeUnixSeconds: 62,
        },
      ]);
      expect(await contract.getNumberStages()).to.equal(2);
      [stageInfo, walletMintedCount] = await contract.getStageInfo(1);
      expect(stageInfo.price).to.equal(ethers.utils.parseEther('0.7'));
      expect(stageInfo.walletLimit).to.equal(5);
      expect(stageInfo.maxStageSupply).to.equal(5);
      expect(stageInfo.merkleRoot).to.equal(ethers.utils.hexZeroPad('0x4', 32));
      expect(walletMintedCount).to.equal(0);
    });

    it('gets stage info', async () => {
      await contract.setStages([
        {
          price: ethers.utils.parseEther('0.5'),
          mintFee: 0,
          walletLimit: 3,
          merkleRoot: ethers.utils.hexZeroPad('0x1', 32),
          maxStageSupply: 5,
          startTimeUnixSeconds: 0,
          endTimeUnixSeconds: 1,
        },
      ]);

      expect(await contract.getNumberStages()).to.equal(1);

      const [stageInfo, walletMintedCount] = await contract.getStageInfo(0);
      expect(stageInfo.price).to.equal(ethers.utils.parseEther('0.5'));
      expect(stageInfo.walletLimit).to.equal(3);
      expect(stageInfo.maxStageSupply).to.equal(5);
      expect(stageInfo.merkleRoot).to.equal(ethers.utils.hexZeroPad('0x1', 32));
      expect(walletMintedCount).to.equal(0);
    });

    it('gets stage info reverts for non-existent stage', async () => {
      await contract.setStages([
        {
          price: ethers.utils.parseEther('0.5'),
          mintFee: 0,
          walletLimit: 3,
          merkleRoot: ethers.utils.hexZeroPad('0x1', 32),
          maxStageSupply: 5,
          startTimeUnixSeconds: 0,
          endTimeUnixSeconds: 1,
        },
      ]);

      const getStageInfo = readonlyContract.getStageInfo(1);
      await expect(getStageInfo).to.be.revertedWith('InvalidStage');
    });

    it('can find active stage', async () => {
      await contract.setStages([
        {
          price: ethers.utils.parseEther('0.5'),
          mintFee: 0,
          walletLimit: 3,
          merkleRoot: ethers.utils.hexZeroPad('0x1', 32),
          maxStageSupply: 5,
          startTimeUnixSeconds: 0,
          endTimeUnixSeconds: 1,
        },
        {
          price: ethers.utils.parseEther('0.6'),
          mintFee: 0,
          walletLimit: 4,
          merkleRoot: ethers.utils.hexZeroPad('0x2', 32),
          maxStageSupply: 10,
          startTimeUnixSeconds: 61,
          endTimeUnixSeconds: 62,
        },
      ]);

      expect(await contract.getNumberStages()).to.equal(2);
      expect(await contract.getActiveStageFromTimestamp(0)).to.equal(0);

      expect(await contract.getActiveStageFromTimestamp(61)).to.equal(1);

      const setActiveStage = contract.getActiveStageFromTimestamp(70);
      await expect(setActiveStage).to.be.revertedWith('InvalidStage');
    });
  });

  describe('Minting', function () {
    it('revert if incorrect (less) amount sent', async () => {
      // Get an estimated stage start time
      const block = await ethers.provider.getBlock(
        await ethers.provider.getBlockNumber(),
      );
      // +10 is a number bigger than the count of transactions up to mint
      const stageStart = block.timestamp + 10;
      // Set stages
      await contract.setStages([
        {
          price: ethers.utils.parseEther('0.5'),
          mintFee: 0,
          walletLimit: 10,
          merkleRoot: ethers.utils.hexZeroPad('0x1', 32),
          maxStageSupply: 5,
          startTimeUnixSeconds: stageStart,
          endTimeUnixSeconds: stageStart + 2,
        },
      ]);
      await contract.setMintable(true);

      // Setup the test context: block.timestamp should comply to the stage being active
      await ethers.provider.send('evm_mine', [stageStart - 1]);
      let mint;
      mint = contract.mint(5, [ethers.utils.hexZeroPad('0x', 32)], 0, '0x00', {
        value: ethers.utils.parseEther('2.499'),
      });
      await expect(mint).to.be.revertedWith('NotEnoughValue');

      mint = contract.mint(1, [ethers.utils.hexZeroPad('0x', 32)], 0, '0x00', {
        value: ethers.utils.parseEther('0.499999'),
      });
      await expect(mint).to.be.revertedWith('NotEnoughValue');
    });

    it('revert on reentrancy', async () => {
      const reentrancyFactory = await ethers.getContractFactory(
        'TestReentrantExploit',
      );
      const reentrancyExploiter = await reentrancyFactory.deploy(
        contract.address,
      );
      await reentrancyExploiter.deployed();

      // Get an estimated timestamp for the stage start
      const block = await ethers.provider.getBlock(
        await ethers.provider.getBlockNumber(),
      );
      // +10 is a number bigger than the count of transactions up to mint
      const stageStart = block.timestamp + 10;
      // Set stages
      await contract.setStages([
        {
          price: ethers.utils.parseEther('0.1'),
          mintFee: 0,
          walletLimit: 0,
          merkleRoot: ethers.utils.hexZeroPad('0x', 32),
          maxStageSupply: 0,
          startTimeUnixSeconds: stageStart,
          endTimeUnixSeconds: stageStart + 100000,
        },
      ]);
      await contract.setMintable(true);

      // Setup the test context: block.timestamp should comply to the stage being active
      await ethers.provider.send('evm_mine', [stageStart - 1]);
      await expect(
        reentrancyExploiter.exploit(1, [], stageStart, '0x', {
          value: ethers.utils.parseEther('0.2'),
        }),
      ).to.be.revertedWith('ReentrancyGuardReentrantCall');
    });

    it('can set max mintable supply', async () => {
      await contract.setMaxMintableSupply(99);
      expect(await contract.getMaxMintableSupply()).to.equal(99);

      // can set the mintable supply again with the same value
      await contract.setMaxMintableSupply(99);
      expect(await contract.getMaxMintableSupply()).to.equal(99);

      // can set the mintable supply again with the lower value
      await contract.setMaxMintableSupply(98);
      expect(await contract.getMaxMintableSupply()).to.equal(98);

      // can not set the mintable supply with higher value
      await expect(contract.setMaxMintableSupply(100)).to.be.rejectedWith(
        'CannotIncreaseMaxMintableSupply',
      );

      // readonlyContract should not be able to set max mintable supply
      await expect(
        readonlyContract.setMaxMintableSupply(99),
      ).to.be.revertedWith('Ownable');
    });

    it('enforces max mintable supply', async () => {
      await contract.setMaxMintableSupply(99);
      await contract.setStages([
        {
          price: ethers.utils.parseEther('0.5'),
          mintFee: 0,
          walletLimit: 10,
          merkleRoot: ethers.utils.hexZeroPad('0x1', 32),
          maxStageSupply: 5,
          startTimeUnixSeconds: 0,
          endTimeUnixSeconds: 1,
        },
        {
          price: ethers.utils.parseEther('0.6'),
          mintFee: 0,
          walletLimit: 10,
          merkleRoot: ethers.utils.hexZeroPad('0x2', 32),
          maxStageSupply: 10,
          startTimeUnixSeconds: 61,
          endTimeUnixSeconds: 62,
        },
      ]);
      await contract.setMintable(true);

      // Mint 100 tokens (1 over MaxMintableSupply)
      const mint = contract.mint(
        100,
        [ethers.utils.hexZeroPad('0x', 32)],
        0,
        '0x00',
        {
          value: ethers.utils.parseEther('2.5'),
        },
      );
      await expect(mint).to.be.revertedWith('NoSupplyLeft');
    });

    it('mint with unlimited stage limit', async () => {
      const block = await ethers.provider.getBlock(
        await ethers.provider.getBlockNumber(),
      );
      // +10 is a number bigger than the count of transactions up to mint
      const stageStart = block.timestamp + 10;
      // Set stages
      await contract.setStages([
        {
          price: ethers.utils.parseEther('0.5'),
          mintFee: 0,
          walletLimit: 100,
          merkleRoot: ethers.utils.hexZeroPad('0x0', 32),
          maxStageSupply: 0,
          startTimeUnixSeconds: stageStart,
          endTimeUnixSeconds: stageStart + 2,
        },
      ]);
      await contract.setMaxMintableSupply(999);
      await contract.setMintable(true);

      // Setup the test context: block.timestamp should comply to the stage being active
      await ethers.provider.send('evm_mine', [stageStart - 1]);
      // Mint 100 tokens - wallet limit
      await contract.mint(100, [ethers.utils.hexZeroPad('0x', 32)], 0, '0x00', {
        value: ethers.utils.parseEther('50'),
      });

      // Mint one more should fail
      const mint = contract.mint(
        1,
        [ethers.utils.hexZeroPad('0x', 32)],
        0,
        '0x00',
        {
          value: ethers.utils.parseEther('0.5'),
        },
      );

      await expect(mint).to.be.revertedWith('WalletStageLimitExceeded');
    });

    it('mint with unlimited wallet limit', async () => {
      const block = await ethers.provider.getBlock(
        await ethers.provider.getBlockNumber(),
      );
      // +10 is a number bigger than the count of transactions up to mint
      const stageStart = block.timestamp + 10;
      // Set stages
      await contract.setStages([
        {
          price: ethers.utils.parseEther('0.5'),
          mintFee: 0,
          walletLimit: 0,
          merkleRoot: ethers.utils.hexZeroPad('0x0', 32),
          maxStageSupply: 100,
          startTimeUnixSeconds: stageStart,
          endTimeUnixSeconds: stageStart + 2,
        },
      ]);
      await contract.setMaxMintableSupply(999);
      await contract.setMintable(true);

      // Setup the test context: Update block.timestamp to comply to the stage being active
      await ethers.provider.send('evm_mine', [stageStart - 1]);
      // Mint 100 tokens - stage limit
      await contract.mint(100, [ethers.utils.hexZeroPad('0x', 32)], 0, '0x00', {
        value: ethers.utils.parseEther('50'),
      });

      // Mint one more should fail
      const mint = contract.mint(
        1,
        [ethers.utils.hexZeroPad('0x', 32)],
        0,
        '0x00',
        {
          value: ethers.utils.parseEther('0.5'),
        },
      );

      await expect(mint).to.be.revertedWith('StageSupplyExceeded');
    });

    it('mint with free stage', async () => {
      const block = await ethers.provider.getBlock(
        await ethers.provider.getBlockNumber(),
      );
      // +10 is a number bigger than the count of transactions up to mint
      const stageStart = block.timestamp + 10;
      // Set stages
      await contract.setStages([
        {
          price: ethers.utils.parseEther('0'),
          mintFee: 0,
          walletLimit: 0,
          merkleRoot: ethers.utils.hexZeroPad('0x0', 32),
          maxStageSupply: 100,
          startTimeUnixSeconds: stageStart,
          endTimeUnixSeconds: stageStart + 1,
        },
      ]);
      await contract.setMintable(true);

      // Setup the test context: Update block.timestamp to comply to the stage being active
      await ethers.provider.send('evm_mine', [stageStart - 1]);
      // Mint 100 tokens - stage limit
      await readonlyContract.mint(
        1,
        [ethers.utils.hexZeroPad('0x', 32)],
        0,
        '0x00',
        {
          value: ethers.utils.parseEther('0'),
        },
      );
      const [stageInfo, walletMintedCount, stagedMintedCount] =
        await readonlyContract.getStageInfo(0);
      expect(stageInfo.maxStageSupply).to.equal(100);
      expect(walletMintedCount).to.equal(1);
      expect(stagedMintedCount.toNumber()).to.equal(1);
    });

    it('enforces stage supply', async () => {
      const block = await ethers.provider.getBlock(
        await ethers.provider.getBlockNumber(),
      );
      // +10 is a number bigger than the count of transactions up to mint
      const stageStart = block.timestamp + 10;
      // Set stages
      await contract.setStages([
        {
          price: ethers.utils.parseEther('0.5'),
          mintFee: 0,
          walletLimit: 10,
          merkleRoot: ethers.utils.hexZeroPad('0x0', 32),
          maxStageSupply: 5,
          startTimeUnixSeconds: stageStart,
          endTimeUnixSeconds: stageStart + 3,
        },
        {
          price: ethers.utils.parseEther('0.6'),
          mintFee: 0,
          walletLimit: 10,
          merkleRoot: ethers.utils.hexZeroPad('0x0', 32),
          maxStageSupply: 10,
          startTimeUnixSeconds: stageStart + 63,
          endTimeUnixSeconds: stageStart + 66,
        },
      ]);
      await contract.setMintable(true);

      // Setup the test context: Update block.timestamp to comply to the stage being active
      await ethers.provider.send('evm_mine', [stageStart - 1]);
      // Mint 5 tokens
      await expect(
        contract.mint(5, [ethers.utils.hexZeroPad('0x', 32)], 0, '0x00', {
          value: ethers.utils.parseEther('2.5'),
        }),
      ).to.emit(contract, 'Transfer');

      let [stageInfo, walletMintedCount, stagedMintedCount] =
        await contract.getStageInfo(0);

      expect(stageInfo.maxStageSupply).to.equal(5);
      expect(walletMintedCount).to.equal(5);
      expect(stagedMintedCount.toNumber()).to.equal(5);

      // Mint another 1 should fail since the stage limit has been reached.
      let mint = contract.mint(
        1,
        [ethers.utils.hexZeroPad('0x', 32)],
        0,
        '0x00',
        {
          value: ethers.utils.parseEther('0.5'),
        },
      );
      await expect(mint).to.be.revertedWith('StageSupplyExceeded');

      // Mint another 5 should fail since the stage limit has been reached.
      mint = contract.mint(5, [ethers.utils.hexZeroPad('0x', 32)], 0, '0x00', {
        value: ethers.utils.parseEther('2.5'),
      });
      await expect(mint).to.be.revertedWith('StageSupplyExceeded');

      // Setup the test context: Update the block.timestamp to activate the 2nd stage
      await ethers.provider.send('evm_mine', [stageStart + 62]);

      await contract.mint(8, [ethers.utils.hexZeroPad('0x', 32)], 0, '0x00', {
        value: ethers.utils.parseEther('4.8'),
      });
      [stageInfo, walletMintedCount, stagedMintedCount] =
        await contract.getStageInfo(1);
      expect(stageInfo.maxStageSupply).to.equal(10);
      expect(walletMintedCount).to.equal(8);
      expect(stagedMintedCount.toNumber()).to.equal(8);

      await assert.isRejected(
        contract.mint(3, [ethers.utils.hexZeroPad('0x', 32)], 0, '0x00', {
          value: ethers.utils.parseEther('1.8'),
        }),
        /StageSupplyExceeded/,
        "Minting more than the stage's supply should fail",
      );

      await contract.mint(2, [ethers.utils.hexZeroPad('0x', 32)], 0, '0x00', {
        value: ethers.utils.parseEther('1.2'),
      });

      [stageInfo, walletMintedCount, stagedMintedCount] =
        await contract.getStageInfo(1);
      expect(walletMintedCount).to.equal(10);
      expect(stagedMintedCount.toNumber()).to.equal(10);

      [stageInfo, walletMintedCount, stagedMintedCount] =
        await contract.getStageInfo(0);
      expect(walletMintedCount).to.equal(5);
      expect(stagedMintedCount.toNumber()).to.equal(5);

      const [address] = await ethers.getSigners();
      const totalMinted = await contract.totalMintedByAddress(
        await address.getAddress(),
      );
      expect(totalMinted.toNumber()).to.equal(15);
    });

    it('enforces Merkle proof if required', async () => {
      const accounts = (await ethers.getSigners()).map((signer) =>
        getAddress(signer.address).toLowerCase().trim(),
      );
      const leaves = accounts.map((account) =>
        ethers.utils.solidityKeccak256(['address', 'uint32'], [account, 0]),
      );
      const signerAddress = await ethers.provider.getSigner().getAddress();
      const merkleTree = new MerkleTree(leaves, ethers.utils.keccak256, {
        sortPairs: true,
        hashLeaves: false,
      });
      const root = merkleTree.getHexRoot();

      const leaf = ethers.utils.solidityKeccak256(
        ['address', 'uint32'],
        [signerAddress.toLowerCase().trim(), 0],
      );
      const proof = merkleTree.getHexProof(leaf);

      const block = await ethers.provider.getBlock(
        await ethers.provider.getBlockNumber(),
      );
      // +10 is a number bigger than the count of transactions up to mint
      const stageStart = block.timestamp + 10;
      // Set stages
      await contract.setStages([
        {
          price: ethers.utils.parseEther('0.1'),
          mintFee: 0,
          walletLimit: 10,
          merkleRoot: root,
          maxStageSupply: 5,
          startTimeUnixSeconds: stageStart,
          endTimeUnixSeconds: stageStart + 3,
        },
      ]);
      await contract.setMintable(true);

      // Setup the test context: Update block.timestamp to comply to the stage being active
      await ethers.provider.send('evm_mine', [stageStart - 1]);
      // Mint 1 token with valid proof
      await contract.mint(1, proof, 0, '0x00', {
        value: ethers.utils.parseEther('0.1'),
      });
      const totalMinted = await contract.totalMintedByAddress(signerAddress);
      expect(totalMinted.toNumber()).to.equal(1);

      // Mint 1 token with someone's else proof should be reverted
      await expect(
        readonlyContract.mint(1, proof, 0, '0x00', {
          value: ethers.utils.parseEther('0.1'),
        }),
      ).to.be.rejectedWith('InvalidProof');
    });

    it('reverts on invalid Merkle proof', async () => {
      const root = ethers.utils.hexZeroPad('0x1', 32);
      const proof = [ethers.utils.hexZeroPad('0x1', 32)];
      const block = await ethers.provider.getBlock(
        await ethers.provider.getBlockNumber(),
      );
      // +10 is a number bigger than the count of transactions up to mint
      const stageStart = block.timestamp + 10;
      // Set stages
      await contract.setStages([
        {
          price: ethers.utils.parseEther('0.5'),
          mintFee: 0,
          walletLimit: 10,
          merkleRoot: root,
          maxStageSupply: 5,
          startTimeUnixSeconds: stageStart,
          endTimeUnixSeconds: stageStart + 1,
        },
      ]);
      await contract.setMintable(true);

      // Setup the test context: Update block.timestamp to comply to the stage being active
      await ethers.provider.send('evm_mine', [stageStart - 1]);
      // Mint 1 token with invalid proof
      const mint = contract.mint(1, proof, 0, '0x00', {
        value: ethers.utils.parseEther('0.5'),
      });
      await expect(mint).to.be.revertedWith('InvalidProof');
    });

    it('mint with limit', async () => {
      const ownerAddress = await owner.getAddress();
      const readerAddress = await readonly.getAddress();
      const leaves = [
        ethers.utils.solidityKeccak256(
          ['address', 'uint32'],
          [ownerAddress, 2],
        ),
        ethers.utils.solidityKeccak256(
          ['address', 'uint32'],
          [readerAddress, 5],
        ),
      ];

      const merkleTree = new MerkleTree(leaves, ethers.utils.keccak256, {
        sortPairs: true,
        hashLeaves: false,
      });
      const root = merkleTree.getHexRoot();
      const ownerLeaf = ethers.utils.solidityKeccak256(
        ['address', 'uint32'],
        [ownerAddress, 2],
      );
      const readerLeaf = ethers.utils.solidityKeccak256(
        ['address', 'uint32'],
        [readerAddress, 5],
      );
      const ownerProof = merkleTree.getHexProof(ownerLeaf);
      const readerProof = merkleTree.getHexProof(readerLeaf);

      const block = await ethers.provider.getBlock(
        await ethers.provider.getBlockNumber(),
      );
      // +10 is a number bigger than the count of transactions up to mint
      const stageStart = block.timestamp + 10;
      // Set stages
      await contract.setStages([
        {
          price: ethers.utils.parseEther('0.1'),
          mintFee: 0,
          walletLimit: 10,
          merkleRoot: root,
          maxStageSupply: 100,
          startTimeUnixSeconds: stageStart,
          endTimeUnixSeconds: stageStart + 100,
        },
      ]);
      await contract.setMintable(true);

      // Setup the test context: Update block.timestamp to comply to the stage being active
      await ethers.provider.send('evm_mine', [stageStart - 1]);

      // Owner mints 1 token with valid proof
      await contract.mintWithLimit(1, 2, ownerProof, 0, '0x00', {
        value: ethers.utils.parseEther('0.1'),
      });
      expect(
        (await contract.totalMintedByAddress(owner.getAddress())).toNumber(),
      ).to.equal(1);

      // Owner mints 1 token with wrong limit and should be reverted.
      await expect(
        contract.mintWithLimit(1, 3, ownerProof, 0, '0x00', {
          value: ethers.utils.parseEther('0.1'),
        }),
      ).to.be.rejectedWith('InvalidProof');

      // Owner mints 2 tokens with valid proof and reverts.
      await expect(
        contract.mintWithLimit(2, 2, ownerProof, 0, '0x00', {
          value: ethers.utils.parseEther('0.2'),
        }),
      ).to.be.rejectedWith('WalletStageLimitExceeded');

      // Owner mints 1 token with valid proof. Now owner reaches the limit.
      await contract.mintWithLimit(1, 2, ownerProof, 0, '0x00', {
        value: ethers.utils.parseEther('0.1'),
      });
      expect(
        (await contract.totalMintedByAddress(owner.getAddress())).toNumber(),
      ).to.equal(2);

      // Owner tries to mint more and reverts.
      await expect(
        contract.mintWithLimit(1, 2, ownerProof, 0, '0x00', {
          value: ethers.utils.parseEther('0.1'),
        }),
      ).to.be.rejectedWith('WalletStageLimitExceeded');

      // Reader mints 6 tokens with valid proof and reverts.
      await expect(
        readonlyContract.mintWithLimit(6, 5, readerProof, 0, '0x00', {
          value: ethers.utils.parseEther('0.6'),
        }),
      ).to.be.rejectedWith('WalletStageLimitExceeded');

      // Reader mints 5 tokens with valid proof.
      await readonlyContract.mintWithLimit(5, 5, readerProof, 0, '0x00', {
        value: ethers.utils.parseEther('0.5'),
      });

      // Reader mints 1 token with valid proof and reverts.
      await expect(
        readonlyContract.mintWithLimit(1, 5, readerProof, 0, '0x00', {
          value: ethers.utils.parseEther('0.1'),
        }),
      ).to.be.rejectedWith('WalletStageLimitExceeded');
    });

    it('crossmint', async () => {
      const crossmintAddressStr = '0xdAb1a1854214684acE522439684a145E62505233';
      [owner, readonly] = await ethers.getSigners();

      cloneFactory = cloneFactory.connect(owner);
      const tx = await cloneFactory.create(
        'TestCollection',
        'TestSymbol',
        '.json',
        1000,
        0,
        60,
        '0x0000000000000000000000000000000000000000',
        '0xef59F379B48f2E92aBD94ADcBf714D170967925D',
        '0xef59F379B48f2E92aBD94ADcBf714D170967925D',
        100,
        );
      
      const receipt = await tx.wait();
      const event = receipt.events!.find(event => event.event === 'CreateClone')!;
      const cloneAddress = event.args![0];
  
      const contractFactory =
          await ethers.getContractFactory('ERC721CMRoyaltiesInitializable');
      const erc721Clone = contractFactory.attach(cloneAddress);

      const ownerConn = erc721Clone.connect(owner);
      const block = await ethers.provider.getBlock(
        await ethers.provider.getBlockNumber(),
      );
      // +10 is a number bigger than the count of transactions up to mint
      const stageStart = block.timestamp + 10;
      // Set stages
      await ownerConn.setStages([
        {
          price: ethers.utils.parseEther('0.5'),
          mintFee: 0,
          walletLimit: 0,
          merkleRoot: ethers.utils.hexZeroPad('0x', 32),
          maxStageSupply: 100,
          startTimeUnixSeconds: stageStart,
          endTimeUnixSeconds: stageStart + 1,
        },
      ]);
      await ownerConn.setMintable(true);
      await ownerConn.setCrossmintAddress(crossmintAddressStr);

      // Impersonate Crossmint wallet
      const crossmintSigner =
        await ethers.getImpersonatedSigner(crossmintAddressStr);
      const crossmintAddress = await crossmintSigner.getAddress();

      // Send some wei to impersonated account
      await ethers.provider.send('hardhat_setBalance', [
        crossmintAddress,
        '0xFFFFFFFFFFFFFFFF',
      ]);

      const crossMintConn = erc721Clone.connect(crossmintSigner);

      // Setup the test context: Update block.timestamp to comply to the stage being active
      await ethers.provider.send('evm_mine', [stageStart - 1]);
      await crossMintConn.crossmint(
        1,
        readonly.address,
        [ethers.utils.hexZeroPad('0x', 32)],
        0,
        '0x00',
        {
          value: ethers.utils.parseEther('0.5'),
        },
      );

      const [stageInfo, walletMintedCount, stagedMintedCount] =
        await ownerConn.getStageInfo(0);
      expect(stageInfo.maxStageSupply).to.equal(100);
      expect(walletMintedCount).to.equal(0);
      expect(stagedMintedCount.toNumber()).to.equal(1);
    });

    it('crossmint reverts if crossmint address not set', async () => {
      const accounts = (await ethers.getSigners()).map((signer) =>
        getAddress(signer.address),
      );
      const [_, recipient] = await ethers.getSigners();

      const merkleTree = new MerkleTree(accounts, keccak256, {
        sortPairs: true,
        hashLeaves: true,
      });
      const root = merkleTree.getHexRoot();
      const proof = merkleTree.getHexProof(keccak256(recipient.address));

      await contract.setStages([
        {
          price: ethers.utils.parseEther('0.5'),
          mintFee: 0,
          walletLimit: 10,
          merkleRoot: root,
          maxStageSupply: 7,
          startTimeUnixSeconds: 0,
          endTimeUnixSeconds: 1,
        },
      ]);
      await contract.setMintable(true);

      const crossmint = contract.crossmint(
        7,
        recipient.address,
        proof,
        0,
        '0x00',
        {
          value: ethers.utils.parseEther('3.5'),
        },
      );

      await expect(crossmint).to.be.revertedWith('CrossmintAddressNotSet');
    });

    it('crossmint reverts on non-Crossmint sender', async () => {
      const accounts = (await ethers.getSigners()).map((signer) =>
        getAddress(signer.address),
      );
      const [_, recipient] = await ethers.getSigners();

      const merkleTree = new MerkleTree(accounts, keccak256, {
        sortPairs: true,
        hashLeaves: true,
      });
      const root = merkleTree.getHexRoot();
      const proof = merkleTree.getHexProof(keccak256(recipient.address));

      await contract.setStages([
        {
          price: ethers.utils.parseEther('0.5'),
          mintFee: 0,
          walletLimit: 10,
          merkleRoot: root,
          maxStageSupply: 7,
          startTimeUnixSeconds: 0,
          endTimeUnixSeconds: 1,
        },
      ]);
      await contract.setMintable(true);
      await contract.setCrossmintAddress(
        '0xdAb1a1854214684acE522439684a145E62505233',
      );

      const crossmint = contract.crossmint(
        7,
        recipient.address,
        proof,
        0,
        '0x00',
        {
          value: ethers.utils.parseEther('3.5'),
        },
      );

      await expect(crossmint).to.be.revertedWith('CrossmintOnly');
    });

    it('mints by owner', async () => {
      await contract.setStages([
        {
          price: ethers.utils.parseEther('0.5'),
          mintFee: 0,
          walletLimit: 1,
          merkleRoot: ethers.utils.hexZeroPad('0x1', 32),
          maxStageSupply: 1,
          startTimeUnixSeconds: 0,
          endTimeUnixSeconds: 1,
        },
      ]);
      await contract.setMintable(true);

      const [owner, address1] = await ethers.getSigners();

      await contract.ownerMint(5, owner.address);

      const [, walletMintedCount, stagedMintedCount] =
        await contract.getStageInfo(0);
      expect(walletMintedCount).to.equal(0);
      expect(stagedMintedCount.toNumber()).to.equal(0);
      const ownerBalance = await contract.balanceOf(owner.address);
      expect(ownerBalance.toNumber()).to.equal(5);

      await contract.ownerMint(5, address1.address);
      const [, address1Minted] = await readonlyContract.getStageInfo(0, {
        from: address1.address,
      });
      expect(address1Minted).to.equal(0);

      const address1Balance = await contract.balanceOf(address1.address);
      expect(address1Balance.toNumber()).to.equal(5);

      expect((await contract.totalSupply()).toNumber()).to.equal(10);
    });

    it('mints by owner - invalid cases', async () => {
      await contract.setStages([
        {
          price: ethers.utils.parseEther('0.5'),
          mintFee: 0,
          walletLimit: 1,
          merkleRoot: ethers.utils.hexZeroPad('0x1', 32),
          maxStageSupply: 1,
          startTimeUnixSeconds: 0,
          endTimeUnixSeconds: 1,
        },
      ]);
      await contract.setMintable(true);
      await expect(
        contract.ownerMint(1001, readonly.address),
      ).to.be.revertedWith('NoSupplyLeft');
    });
  });

  describe('Token URI', function () {
    it('Reverts for nonexistent token', async () => {
      await expect(contract.tokenURI(0)).to.be.revertedWith(
        'URIQueryForNonexistentToken',
      );
    });

    it('Returns empty tokenURI on empty baseURI', async () => {
      const block = await ethers.provider.getBlock(
        await ethers.provider.getBlockNumber(),
      );
      // +10 is a number bigger than the count of transactions up to mint
      const stageStart = block.timestamp + 10;
      // Set stages
      await contract.setStages([
        {
          price: ethers.utils.parseEther('0.5'),
          mintFee: 0,
          walletLimit: 10,
          merkleRoot: ethers.utils.hexZeroPad('0x0', 32),
          maxStageSupply: 5,
          startTimeUnixSeconds: stageStart,
          endTimeUnixSeconds: stageStart + 1,
        },
        {
          price: ethers.utils.parseEther('0.6'),
          mintFee: 0,
          walletLimit: 10,
          merkleRoot: ethers.utils.hexZeroPad('0x0', 32),
          maxStageSupply: 10,
          startTimeUnixSeconds: stageStart + 61,
          endTimeUnixSeconds: stageStart + 62,
        },
      ]);
      await contract.setMintable(true);

      // Setup the test context: Update block.timestamp to comply to the stage being active
      await ethers.provider.send('evm_mine', [stageStart - 1]);
      await contract.mint(2, [ethers.utils.hexZeroPad('0x', 32)], 0, '0x00', {
        value: ethers.utils.parseEther('2.5'),
      });

      expect(await contract.tokenURI(0)).to.equal('');
      expect(await contract.tokenURI(1)).to.equal('');

      await expect(contract.tokenURI(2)).to.be.revertedWith(
        'URIQueryForNonexistentToken',
      );
    });

    it('Returns non-empty tokenURI on non-empty baseURI', async () => {
      const block = await ethers.provider.getBlock(
        await ethers.provider.getBlockNumber(),
      );
      // +10 is a number bigger than the count of transactions up to mint
      const stageStart = block.timestamp + 10;
      // Set stages
      await contract.setStages([
        {
          price: ethers.utils.parseEther('0.5'),
          mintFee: 0,
          walletLimit: 10,
          merkleRoot: ethers.utils.hexZeroPad('0x0', 32),
          maxStageSupply: 5,
          startTimeUnixSeconds: stageStart,
          endTimeUnixSeconds: stageStart + 1,
        },
        {
          price: ethers.utils.parseEther('0.6'),
          mintFee: 0,
          walletLimit: 10,
          merkleRoot: ethers.utils.hexZeroPad('0x0', 32),
          maxStageSupply: 10,
          startTimeUnixSeconds: stageStart + 61,
          endTimeUnixSeconds: stageStart + 62,
        },
      ]);

      await contract.setBaseURI('base_uri_');
      await contract.setMintable(true);

      // Setup the test context: Update block.timestamp to comply to the stage being active
      await ethers.provider.send('evm_mine', [stageStart - 1]);
      await contract.mint(2, [ethers.utils.hexZeroPad('0x', 32)], 0, '0x00', {
        value: ethers.utils.parseEther('2.5'),
      });

      expect(await contract.tokenURI(0)).to.equal('base_uri_0.json');
      expect(await contract.tokenURI(1)).to.equal('base_uri_1.json');

      await expect(contract.tokenURI(2)).to.be.revertedWith(
        'URIQueryForNonexistentToken',
      );
    });
  });

  describe('Global wallet limit', function () {
    it('validates global wallet limit in constructor', async () => {
      [owner] = await ethers.getSigners();
      cloneFactory = cloneFactory.connect(owner);

      await expect(cloneFactory.create(
        'TestCollection',
        'TestSymbol',
        '.json',
        1000,
        1001,
        60,
        '0x0000000000000000000000000000000000000000',
        '0xef59F379B48f2E92aBD94ADcBf714D170967925D',
        '0xef59F379B48f2E92aBD94ADcBf714D170967925D',
        100,
        )).to.be.revertedWith('GlobalWalletLimitOverflow');
    });

    it('sets global wallet limit', async () => {
      await contract.setGlobalWalletLimit(2);
      expect((await contract.getGlobalWalletLimit()).toNumber()).to.equal(2);

      await expect(contract.setGlobalWalletLimit(1001)).to.be.revertedWith(
        'GlobalWalletLimitOverflow',
      );
    });

    it('enforces global wallet limit', async () => {
      await contract.setGlobalWalletLimit(2);
      expect((await contract.getGlobalWalletLimit()).toNumber()).to.equal(2);

      const block = await ethers.provider.getBlock(
        await ethers.provider.getBlockNumber(),
      );
      // +10 is a number bigger than the count of transactions up to mint
      const stageStart = block.timestamp + 10;
      // Set stages
      await contract.setStages([
        {
          price: ethers.utils.parseEther('0.1'),
          mintFee: 0,
          walletLimit: 0,
          merkleRoot: ethers.utils.hexZeroPad('0x0', 32),
          maxStageSupply: 100,
          startTimeUnixSeconds: stageStart,
          endTimeUnixSeconds: stageStart + 2,
        },
      ]);
      await contract.setMintable(true);

      // Setup the test context: Update block.timestamp to comply to the stage being active
      await ethers.provider.send('evm_mine', [stageStart - 1]);
      await contract.mint(2, [ethers.utils.hexZeroPad('0x', 32)], 0, '0x00', {
        value: ethers.utils.parseEther('0.2'),
      });

      await expect(
        contract.mint(1, [ethers.utils.hexZeroPad('0x', 32)], 0, '0x00', {
          value: ethers.utils.parseEther('0.1'),
        }),
      ).to.be.revertedWith('WalletGlobalLimitExceeded');
    });
  });

  describe('Token URI suffix', () => {
    it('can set tokenURI suffix', async () => {
      await contract.setMintable(true);
      await contract.setTokenURISuffix('.json');
      await contract.setBaseURI(
        'ipfs://bafybeidntqfipbuvdhdjosntmpxvxyse2dkyfpa635u4g6txruvt5qf7y4/',
      );

      const block = await ethers.provider.getBlock(
        await ethers.provider.getBlockNumber(),
      );
      // +10 is a number bigger than the count of transactions up to mint
      const stageStart = block.timestamp + 10;
      // Set stages
      await contract.setStages([
        {
          price: ethers.utils.parseEther('0.1'),
          mintFee: 0,
          walletLimit: 0,
          merkleRoot: ethers.utils.hexZeroPad('0x0', 32),
          maxStageSupply: 0,
          startTimeUnixSeconds: stageStart,
          endTimeUnixSeconds: stageStart + 1,
        },
      ]);
      // Setup the test context: Update block.timestamp to comply to the stage being active
      await ethers.provider.send('evm_mine', [stageStart - 1]);
      // Mint and verify
      await contract.mint(1, [ethers.utils.hexZeroPad('0x', 32)], 0, '0x00', {
        value: ethers.utils.parseEther('0.1'),
      });

      const tokenUri = await contract.tokenURI(0);
      expect(tokenUri).to.equal(
        'ipfs://bafybeidntqfipbuvdhdjosntmpxvxyse2dkyfpa635u4g6txruvt5qf7y4/0.json',
      );
    });
  });

  describe('Royalties', function () {
    it('Set default royalty', async () => {
      let royaltyInfo = await contract.royaltyInfo(0, 1000);
      expect(royaltyInfo[0]).to.equal(WALLET_1);
      expect(royaltyInfo[1].toNumber()).to.equal(1);

      royaltyInfo = await contract.royaltyInfo(1, 9999);
      expect(royaltyInfo[0]).to.equal(WALLET_1);
      expect(royaltyInfo[1].toNumber()).to.equal(9);

      royaltyInfo = await contract.royaltyInfo(1111, 9999999999);
      expect(royaltyInfo[0]).to.equal(WALLET_1);
      expect(royaltyInfo[1].toNumber()).to.equal(9999999);

      await contract.setDefaultRoyalty(WALLET_2, 0);

      royaltyInfo = await contract.royaltyInfo(0, 1000);
      expect(royaltyInfo[0]).to.equal(WALLET_2);
      expect(royaltyInfo[1].toNumber()).to.equal(0);

      royaltyInfo = await contract.royaltyInfo(1, 9999);
      expect(royaltyInfo[0]).to.equal(WALLET_2);
      expect(royaltyInfo[1].toNumber()).to.equal(0);

      royaltyInfo = await contract.royaltyInfo(1111, 9999999999);
      expect(royaltyInfo[0]).to.equal(WALLET_2);
      expect(royaltyInfo[1].toNumber()).to.equal(0);
    });

    it('Set token royalty', async () => {
      let royaltyInfo = await contract.royaltyInfo(0, 1000);
      expect(royaltyInfo[0]).to.equal(WALLET_1);
      expect(royaltyInfo[1].toNumber()).to.equal(1);

      royaltyInfo = await contract.royaltyInfo(1, 9999);
      expect(royaltyInfo[0]).to.equal(WALLET_1);
      expect(royaltyInfo[1].toNumber()).to.equal(9);

      royaltyInfo = await contract.royaltyInfo(1111, 9999999999);
      expect(royaltyInfo[0]).to.equal(WALLET_1);
      expect(royaltyInfo[1].toNumber()).to.equal(9999999);

      await contract.setTokenRoyalty(1, WALLET_2, 100);

      royaltyInfo = await contract.royaltyInfo(0, 1000);
      expect(royaltyInfo[0]).to.equal(WALLET_1);
      expect(royaltyInfo[1].toNumber()).to.equal(1);

      royaltyInfo = await contract.royaltyInfo(1, 9999);
      expect(royaltyInfo[0]).to.equal(WALLET_2);
      expect(royaltyInfo[1].toNumber()).to.equal(99);

      royaltyInfo = await contract.royaltyInfo(1111, 9999999999);
      expect(royaltyInfo[0]).to.equal(WALLET_1);
      expect(royaltyInfo[1].toNumber()).to.equal(9999999);
    });

    it('Non-owner update reverts', async () => {
      await expect(
        readonlyContract.setTokenRoyalty(1, WALLET_2, 100),
      ).to.be.revertedWith('OwnableUnauthorizedAccount');

      await expect(
        readonlyContract.setDefaultRoyalty(WALLET_2, 0),
      ).to.be.revertedWith('OwnableUnauthorizedAccount');
    });
  });
});
