import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import chai, { assert, expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { ethers } from 'hardhat';
import { MerkleTree } from 'merkletreejs';
import { ERC721M } from '../typechain-types';

const { keccak256, getAddress } = ethers.utils;
const MINT_FEE_RECEIVER = '0x0B98151bEdeE73f9Ba5F2C7b72dEa02D38Ce49Fc';

chai.use(chaiAsPromised);

describe('ERC721M', function () {
  let contract: ERC721M;
  let readonlyContract: ERC721M;
  let owner: SignerWithAddress;
  let readonly: SignerWithAddress;
  let chainId: number;

  const getCosignSignature = async (
    contractInstance: ERC721M,
    cosigner: SignerWithAddress,
    minter: string,
    timestamp: number,
    qty: number,
  ) => {
    const nonce = await contractInstance.getCosignNonce(minter);
    const digestFromJs = ethers.utils.solidityKeccak256(
      [
        'address',
        'address',
        'uint32',
        'address',
        'uint64',
        'uint256',
        'uint256',
      ],
      [
        contractInstance.address,
        minter,
        qty,
        cosigner.address,
        timestamp,
        chainId,
        nonce,
      ],
    );
    return await cosigner.signMessage(ethers.utils.arrayify(digestFromJs));
  };

  beforeEach(async () => {
    const ERC721M = await ethers.getContractFactory('ERC721M');
    const erc721M = await ERC721M.deploy(
      'Test',
      'TEST',
      '',
      1000,
      0,
      ethers.constants.AddressZero,
      60,
      ethers.constants.AddressZero,
    );
    await erc721M.deployed();

    [owner, readonly] = await ethers.getSigners();
    contract = erc721M.connect(owner);
    readonlyContract = erc721M.connect(readonly);
    chainId = await ethers.provider.getNetwork().then((n) => n.chainId);
  });

  it('Contract can be paused/unpaused', async () => {
    // starts paused
    expect(await contract.getMintable()).to.be.false;

    // unpause
    await contract.setMintable(true);
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
      [contract, owner],
      [-100, 100],
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
            mintFee: ethers.utils.parseEther('0.01'),
            walletLimit: 3,
            merkleRoot: ethers.utils.hexZeroPad('0x1', 32),
            maxStageSupply: 5,
            startTimeUnixSeconds: 0,
            endTimeUnixSeconds: 1,
          },
          {
            price: ethers.utils.parseEther('0.6'),
            mintFee: ethers.utils.parseEther('0.01'),
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
            mintFee: ethers.utils.parseEther('0'),
            walletLimit: 3,
            merkleRoot: ethers.utils.hexZeroPad('0x1', 32),
            maxStageSupply: 5,
            startTimeUnixSeconds: 0,
            endTimeUnixSeconds: 1,
          },
          {
            price: ethers.utils.parseEther('0.6'),
            mintFee: ethers.utils.parseEther('0'),
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
            mintFee: ethers.utils.parseEther('0'),
            walletLimit: 3,
            merkleRoot: ethers.utils.hexZeroPad('0x1', 32),
            maxStageSupply: 5,
            startTimeUnixSeconds: 0,
            endTimeUnixSeconds: 0,
          },
          {
            price: ethers.utils.parseEther('0.6'),
            mintFee: ethers.utils.parseEther('0'),
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
            mintFee: ethers.utils.parseEther('0'),
            walletLimit: 3,
            merkleRoot: ethers.utils.hexZeroPad('0x1', 32),
            maxStageSupply: 5,
            startTimeUnixSeconds: 1,
            endTimeUnixSeconds: 0,
          },
          {
            price: ethers.utils.parseEther('0.6'),
            mintFee: ethers.utils.parseEther('0'),
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
          mintFee: ethers.utils.parseEther('0.01'),
          walletLimit: 3,
          merkleRoot: ethers.utils.hexZeroPad('0x1', 32),
          maxStageSupply: 5,
          startTimeUnixSeconds: 0,
          endTimeUnixSeconds: 1,
        },
        {
          price: ethers.utils.parseEther('0.6'),
          mintFee: ethers.utils.parseEther('0.01'),
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
          mintFee: ethers.utils.parseEther('0.06'),
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
          mintFee: ethers.utils.parseEther('0.06'),
          walletLimit: 4,
          merkleRoot: ethers.utils.hexZeroPad('0x3', 32),
          maxStageSupply: 0,
          startTimeUnixSeconds: 0,
          endTimeUnixSeconds: 1,
        },
        {
          price: ethers.utils.parseEther('0.7'),
          mintFee: ethers.utils.parseEther('0.07'),
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

    it('can update stage', async () => {
      await contract.setStages([
        {
          price: ethers.utils.parseEther('0.5'),
          mintFee: ethers.utils.parseEther('0.05'),
          walletLimit: 3,
          merkleRoot: ethers.utils.hexZeroPad('0x1', 32),
          maxStageSupply: 5,
          startTimeUnixSeconds: 0,
          endTimeUnixSeconds: 1,
        },
        {
          price: ethers.utils.parseEther('0.6'),
          mintFee: ethers.utils.parseEther('0.06'),
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

      // Update first stage
      await expect(
        contract.updateStage(
          /* _index= */ 0,
          /* price= */ ethers.utils.parseEther('0.1'),
          /* mintFee= */ ethers.utils.parseEther('0.01'),
          /* walletLimit= */ 13,
          /* merkleRoot= */ ethers.utils.hexZeroPad('0x9', 32),
          /* maxStageSupply= */ 15,
          /* startTimeUnixSeconds= */ 0,
          /* endTimeUnixSeconds= */ 1,
        ),
      )
        .to.emit(contract, 'UpdateStage')
        .withArgs(
          0,
          ethers.utils.parseEther('0.1'),
          ethers.utils.parseEther('0.01'),
          13,
          ethers.utils.hexZeroPad('0x9', 32),
          15,
          0,
          1,
        );

      expect(await contract.getNumberStages()).to.equal(2);

      [stageInfo, walletMintedCount] = await contract.getStageInfo(0);
      expect(stageInfo.price).to.equal(ethers.utils.parseEther('0.1'));
      expect(stageInfo.walletLimit).to.equal(13);
      expect(stageInfo.maxStageSupply).to.equal(15);
      expect(stageInfo.merkleRoot).to.equal(ethers.utils.hexZeroPad('0x9', 32));
      expect(walletMintedCount).to.equal(0);

      // Stage 2 is unchanged.
      [stageInfo, walletMintedCount] = await contract.getStageInfo(1);
      expect(stageInfo.price).to.equal(ethers.utils.parseEther('0.6'));
      expect(stageInfo.walletLimit).to.equal(4);
      expect(stageInfo.maxStageSupply).to.equal(10);
      expect(stageInfo.merkleRoot).to.equal(ethers.utils.hexZeroPad('0x2', 32));
      expect(walletMintedCount).to.equal(0);
    });

    it('updates stage reverts for non-existent stage', async () => {
      await contract.setStages([
        {
          price: ethers.utils.parseEther('0.5'),
          mintFee: ethers.utils.parseEther('0.05'),
          walletLimit: 3,
          merkleRoot: ethers.utils.hexZeroPad('0x1', 32),
          maxStageSupply: 5,
          startTimeUnixSeconds: 0,
          endTimeUnixSeconds: 1,
        },
        {
          price: ethers.utils.parseEther('0.6'),
          mintFee: ethers.utils.parseEther('0.06'),
          walletLimit: 4,
          merkleRoot: ethers.utils.hexZeroPad('0x2', 32),
          maxStageSupply: 10,
          startTimeUnixSeconds: 61,
          endTimeUnixSeconds: 62,
        },
      ]);

      // Update a stage which doesn't exist.
      const updateStage = contract.updateStage(
        /* _index= */ 2,
        /* price= */ ethers.utils.parseEther('0.1'),
        /* mintFee= */ ethers.utils.parseEther('0.01'),
        /* walletLimit= */ 13,
        /* merkleRoot= */ ethers.utils.hexZeroPad('0x9', 32),
        /* maxStageSupply= */ 15,
        /* startTimeUnixSeconds= */ 0,
        /* endTimeUnixSeconds= */ 0,
      );

      await expect(updateStage).to.be.revertedWith('InvalidStage');
    });

    it('cannot update stage to insufficient stage gap', async () => {
      await contract.setStages([
        {
          price: ethers.utils.parseEther('0.5'),
          mintFee: ethers.utils.parseEther('0.05'),
          walletLimit: 3,
          merkleRoot: ethers.utils.hexZeroPad('0x1', 32),
          maxStageSupply: 5,
          startTimeUnixSeconds: 0,
          endTimeUnixSeconds: 1,
        },
        {
          price: ethers.utils.parseEther('0.6'),
          mintFee: ethers.utils.parseEther('0.06'),
          walletLimit: 4,
          merkleRoot: ethers.utils.hexZeroPad('0x2', 32),
          maxStageSupply: 10,
          startTimeUnixSeconds: 61,
          endTimeUnixSeconds: 62,
        },
      ]);

      // Set stage 1 to only be 59 seconds from stage 2
      const updateStage = contract.updateStage(
        /* _index= */ 1,
        /* price= */ ethers.utils.parseEther('0.1'),
        /* mintFee= */ ethers.utils.parseEther('0.01'),
        /* walletLimit= */ 13,
        /* merkleRoot= */ ethers.utils.hexZeroPad('0x9', 32),
        /* maxStageSupply= */ 15,
        /* startTimeUnixSeconds= */ 0,
        /* endTimeUnixSeconds= */ 2,
      );

      await expect(updateStage).to.be.revertedWith('InsufficientStageTimeGap');
    });

    it('cannot update stage due to the startTimeUnixSeconds is not smaller than the endTimeUnixSeconds', async () => {
      await contract.setStages([
        {
          price: ethers.utils.parseEther('0.5'),
          mintFee: ethers.utils.parseEther('0.05'),
          walletLimit: 3,
          merkleRoot: ethers.utils.hexZeroPad('0x1', 32),
          maxStageSupply: 5,
          startTimeUnixSeconds: 0,
          endTimeUnixSeconds: 1,
        },
        {
          price: ethers.utils.parseEther('0.6'),
          mintFee: ethers.utils.parseEther('0.06'),
          walletLimit: 4,
          merkleRoot: ethers.utils.hexZeroPad('0x2', 32),
          maxStageSupply: 10,
          startTimeUnixSeconds: 61,
          endTimeUnixSeconds: 62,
        },
      ]);

      // Update stage 1 and set startTimeUnixSeconds and endTimeUnixSeconds to identical values
      const updateStageWithIdenticalStartAndEndTime = contract.updateStage(
        /* _index= */ 1,
        /* price= */ ethers.utils.parseEther('0.1'),
        /* mintFee= */ ethers.utils.parseEther('0.01'),
        /* walletLimit= */ 13,
        /* merkleRoot= */ ethers.utils.hexZeroPad('0x9', 32),
        /* maxStageSupply= */ 15,
        /* startTimeUnixSeconds= */ 61,
        /* endTimeUnixSeconds= */ 61,
      );

      await expect(updateStageWithIdenticalStartAndEndTime).to.be.revertedWith(
        'InvalidStartAndEndTimestamp',
      );

      // Update stage 1 and set startTimeUnixSeconds to a value which is not smaller than the endTimeUnixSeconds
      const updateStageWithStartTimeAfterEndTime = contract.updateStage(
        /* _index= */ 1,
        /* price= */ ethers.utils.parseEther('0.1'),
        /* mintFee= */ ethers.utils.parseEther('0.01'),
        /* walletLimit= */ 13,
        /* merkleRoot= */ ethers.utils.hexZeroPad('0x9', 32),
        /* maxStageSupply= */ 15,
        /* startTimeUnixSeconds= */ 61,
        /* endTimeUnixSeconds= */ 60,
      );

      await expect(updateStageWithStartTimeAfterEndTime).to.be.revertedWith(
        'InvalidStartAndEndTimestamp',
      );
    });

    it('gets stage info', async () => {
      await contract.setStages([
        {
          price: ethers.utils.parseEther('0.5'),
          mintFee: ethers.utils.parseEther('0.05'),
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
          mintFee: ethers.utils.parseEther('0.05'),
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
          mintFee: ethers.utils.parseEther('0.05'),
          walletLimit: 3,
          merkleRoot: ethers.utils.hexZeroPad('0x1', 32),
          maxStageSupply: 5,
          startTimeUnixSeconds: 0,
          endTimeUnixSeconds: 1,
        },
        {
          price: ethers.utils.parseEther('0.6'),
          mintFee: ethers.utils.parseEther('0.06'),
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

    it('revert if contract is not mintable', async () => {
      await contract.setStages([
        {
          price: ethers.utils.parseEther('0.5'),
          mintFee: ethers.utils.parseEther('0.05'),
          walletLimit: 10,
          merkleRoot: ethers.utils.hexZeroPad('0x1', 32),
          maxStageSupply: 5,
          startTimeUnixSeconds: 0,
          endTimeUnixSeconds: 1,
        },
      ]);

      // not mintable by owner
      let mint = contract.mint(
        1,
        [ethers.utils.hexZeroPad('0x', 32)],
        0,
        '0x00',
        {
          value: ethers.utils.parseEther('0.5'),
        },
      );
      await expect(mint).to.be.revertedWith('NotMintable');

      // not mintable by readonly address
      mint = readonlyContract.mint(
        1,
        [ethers.utils.hexZeroPad('0x', 32)],
        0,
        '0x00',
        {
          value: ethers.utils.parseEther('0.5'),
        },
      );
      await expect(mint).to.be.revertedWith('NotMintable');
    });

    it('revert if contract without stages', async () => {
      await contract.setMintable(true);
      const mint = contract.mint(
        1,
        [ethers.utils.hexZeroPad('0x', 32)],
        0,
        '0x00',
        {
          value: ethers.utils.parseEther('0.5'),
        },
      );

      await expect(mint).to.be.revertedWith('InvalidStage');
    });

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
          price: ethers.utils.parseEther('0.4'),
          mintFee: ethers.utils.parseEther('0.1'),
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
          mintFee: ethers.utils.parseEther('0.01'),
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
      ).to.be.revertedWith('ReentrancyGuard: reentrant call');
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
          mintFee: ethers.utils.parseEther('0.05'),
          walletLimit: 10,
          merkleRoot: ethers.utils.hexZeroPad('0x1', 32),
          maxStageSupply: 5,
          startTimeUnixSeconds: 0,
          endTimeUnixSeconds: 1,
        },
        {
          price: ethers.utils.parseEther('0.6'),
          mintFee: ethers.utils.parseEther('0.06'),
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

    it('mint with wallet limit', async () => {
      const block = await ethers.provider.getBlock(
        await ethers.provider.getBlockNumber(),
      );
      // +10 is a number bigger than the count of transactions up to mint
      const stageStart = block.timestamp + 10;
      // Set stages
      await contract.setStages([
        {
          price: ethers.utils.parseEther('0.5'),
          mintFee: ethers.utils.parseEther('0'),
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

    it('mint with limited stage supply', async () => {
      const block = await ethers.provider.getBlock(
        await ethers.provider.getBlockNumber(),
      );
      // +10 is a number bigger than the count of transactions up to mint
      const stageStart = block.timestamp + 10;
      // Set stages
      await contract.setStages([
        {
          price: ethers.utils.parseEther('0.5'),
          mintFee: ethers.utils.parseEther('0'),
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

      const contractBalanceInitial = await ethers.provider.getBalance(contract.address);
      const mintFeeReceiverBalanceInitial = await ethers.provider.getBalance(MINT_FEE_RECEIVER);

      // Setup the test context: Update block.timestamp to comply to the stage being active
      await ethers.provider.send('evm_mine', [stageStart - 1]);
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

      const contractBalancePost = await ethers.provider.getBalance(contract.address)
      expect(contractBalancePost.sub(contractBalanceInitial)).to.equal(0);

      const mintFeeReceiverBalancePost = await ethers.provider.getBalance(MINT_FEE_RECEIVER)
      expect(mintFeeReceiverBalancePost.sub(mintFeeReceiverBalanceInitial)).to.equal(0);
    });

    it('mint with free stage with mint fee', async () => {
      const block = await ethers.provider.getBlock(
        await ethers.provider.getBlockNumber(),
      );
      // +10 is a number bigger than the count of transactions up to mint
      const stageStart = block.timestamp + 10;
      // Set stages
      await contract.setStages([
        {
          price: ethers.utils.parseEther('0'),
          mintFee: ethers.utils.parseEther('0.5'),
          walletLimit: 0,
          merkleRoot: ethers.utils.hexZeroPad('0x0', 32),
          maxStageSupply: 100,
          startTimeUnixSeconds: stageStart,
          endTimeUnixSeconds: stageStart + 1,
        },
      ]);
      await contract.setMintable(true);

      const contractBalanceInitial = await ethers.provider.getBalance(contract.address);
      const mintFeeReceiverBalanceInitial = await ethers.provider.getBalance(MINT_FEE_RECEIVER);

      // Setup the test context: Update block.timestamp to comply to the stage being active
      await ethers.provider.send('evm_mine', [stageStart - 1]);
      await readonlyContract.mint(
        1,
        [ethers.utils.hexZeroPad('0x', 32)],
        0,
        '0x00',
        {
          value: ethers.utils.parseEther('0.5'),
        },
      );
      const [stageInfo, walletMintedCount, stagedMintedCount] =
        await readonlyContract.getStageInfo(0);
      expect(stageInfo.maxStageSupply).to.equal(100);
      expect(walletMintedCount).to.equal(1);
      expect(stagedMintedCount.toNumber()).to.equal(1);

      const contractBalancePost = await ethers.provider.getBalance(contract.address)
      expect(contractBalancePost.sub(contractBalanceInitial)).to.equal(0);

      const mintFeeReceiverBalancePost = await ethers.provider.getBalance(MINT_FEE_RECEIVER)
      expect(mintFeeReceiverBalancePost.sub(mintFeeReceiverBalanceInitial)).to.equal(ethers.utils.parseEther('0.5'));
    });

    it('mint with cosign - happy path', async () => {
      const [_owner, minter, cosigner] = await ethers.getSigners();
      const block = await ethers.provider.getBlock(
        await ethers.provider.getBlockNumber(),
      );
      const stageStart = block.timestamp;

      await contract.setStages([
        {
          price: ethers.utils.parseEther('0'),
          mintFee: ethers.utils.parseEther('0'),
          walletLimit: 0,
          merkleRoot: ethers.utils.hexZeroPad('0x', 32),
          maxStageSupply: 100,
          startTimeUnixSeconds: stageStart,
          endTimeUnixSeconds: stageStart + 1000,
        },
      ]);
      await contract.setMintable(true);
      await contract.setCosigner(cosigner.address);

      const timestamp = stageStart + 200;
      const sig = getCosignSignature(
        contract,
        cosigner,
        minter.address,
        timestamp,
        1,
      );
      await readonlyContract.mint(
        1,
        [ethers.utils.hexZeroPad('0x', 32)],
        timestamp,
        sig,
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

    it('mint with cosign - invalid sigs', async () => {
      const [_owner, minter, cosigner] = await ethers.getSigners();
      await contract.setStages([
        {
          price: ethers.utils.parseEther('0'),
          mintFee: ethers.utils.parseEther('0'),
          walletLimit: 0,
          merkleRoot: ethers.utils.hexZeroPad('0x1', 32),
          maxStageSupply: 100,
          startTimeUnixSeconds: 0,
          endTimeUnixSeconds: 1,
        },
      ]);
      await contract.setMintable(true);
      await contract.setCosigner(cosigner.address);

      const timestamp = Math.floor(new Date().getTime() / 1000);
      const sig = await getCosignSignature(
        contract,
        cosigner,
        minter.address,
        timestamp,
        1,
      );

      // invalid because of unexpected timestamp
      await expect(
        readonlyContract.mint(
          1,
          [ethers.utils.hexZeroPad('0x', 32)],
          timestamp + 1,
          sig,
          {
            value: ethers.utils.parseEther('0'),
          },
        ),
      ).to.be.revertedWith('InvalidCosignSignature');

      // invalid because of unexptected sig
      await expect(
        readonlyContract.mint(
          1,
          [ethers.utils.hexZeroPad('0x', 32)],
          timestamp,
          sig + '00',
          {
            value: ethers.utils.parseEther('0'),
          },
        ),
      ).to.be.revertedWith('InvalidCosignSignature');
      await expect(
        readonlyContract.mint(
          1,
          [ethers.utils.hexZeroPad('0x', 32)],
          timestamp,
          '0x00',
          {
            value: ethers.utils.parseEther('0'),
          },
        ),
      ).to.be.revertedWith('InvalidCosignSignature');
      await expect(
        readonlyContract.mint(
          1,
          [ethers.utils.hexZeroPad('0x', 32)],
          timestamp,
          '0',
          {
            value: ethers.utils.parseEther('0'),
          },
        ),
      ).to.be.rejectedWith('invalid arrayify');
      await expect(
        readonlyContract.mint(
          1,
          [ethers.utils.hexZeroPad('0x', 32)],
          timestamp,
          '',
          {
            value: ethers.utils.parseEther('0'),
          },
        ),
      ).to.be.rejectedWith('invalid arrayify');

      // invalid because of unawait expected minter
      await expect(
        contract.mint(1, [ethers.utils.hexZeroPad('0x', 32)], timestamp, sig, {
          value: ethers.utils.parseEther('0'),
        }),
      ).to.be.revertedWith('InvalidCosignSignature');
    });

    it('mint with cosign - timestamp out of stage', async () => {
      const [_owner, minter, cosigner] = await ethers.getSigners();
      const block = await ethers.provider.getBlock(
        await ethers.provider.getBlockNumber(),
      );
      const stageStart = block.timestamp;
      await contract.setStages([
        {
          price: ethers.utils.parseEther('0'),
          mintFee: ethers.utils.parseEther('0'),
          walletLimit: 0,
          merkleRoot: ethers.utils.hexZeroPad('0x1', 32),
          maxStageSupply: 100,
          startTimeUnixSeconds: stageStart,
          endTimeUnixSeconds: stageStart + 1000,
        },
      ]);
      await contract.setMintable(true);
      await contract.setCosigner(cosigner.address);

      const earlyTimestamp = stageStart - 1;
      let sig = getCosignSignature(
        readonlyContract,
        cosigner,
        minter.address,
        earlyTimestamp,
        1,
      );

      await expect(
        readonlyContract.mint(
          1,
          [ethers.utils.hexZeroPad('0x', 32)],
          earlyTimestamp,
          sig,
          {
            value: ethers.utils.parseEther('0'),
          },
        ),
      ).to.be.revertedWith('InvalidStage');

      const lateTimestamp = stageStart + 1001;
      sig = getCosignSignature(
        readonlyContract,
        cosigner,
        minter.address,
        lateTimestamp,
        1,
      );

      await expect(
        readonlyContract.mint(
          1,
          [ethers.utils.hexZeroPad('0x', 32)],
          lateTimestamp,
          sig,
          {
            value: ethers.utils.parseEther('0'),
          },
        ),
      ).to.be.revertedWith('InvalidStage');
    });

    it('mint with cosign - expired signature', async () => {
      const [_owner, minter, cosigner] = await ethers.getSigners();
      const block = await ethers.provider.getBlock(
        await ethers.provider.getBlockNumber(),
      );
      const stageStart = block.timestamp;
      await contract.setStages([
        {
          price: ethers.utils.parseEther('0'),
          mintFee: ethers.utils.parseEther('0'),
          walletLimit: 0,
          merkleRoot: ethers.utils.hexZeroPad('0x1', 32),
          maxStageSupply: 100,
          startTimeUnixSeconds: stageStart,
          endTimeUnixSeconds: stageStart + 1000,
        },
      ]);
      await contract.setMintable(true);
      await contract.setCosigner(cosigner.address);

      const timestamp = stageStart;
      const sig = getCosignSignature(
        readonlyContract,
        cosigner,
        minter.address,
        timestamp,
        1,
      );

      // fast forward 2 minutes
      await ethers.provider.send('evm_increaseTime', [120]);
      await ethers.provider.send('evm_mine', []);

      await expect(
        readonlyContract.mint(
          1,
          [ethers.utils.hexZeroPad('0x', 32)],
          timestamp,
          sig,
          {
            value: ethers.utils.parseEther('0'),
          },
        ),
      ).to.be.revertedWith('TimestampExpired');
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
          mintFee: ethers.utils.parseEther('0'),
          walletLimit: 10,
          merkleRoot: ethers.utils.hexZeroPad('0x0', 32),
          maxStageSupply: 5,
          startTimeUnixSeconds: stageStart,
          endTimeUnixSeconds: stageStart + 3,
        },
        {
          price: ethers.utils.parseEther('0.6'),
          mintFee: ethers.utils.parseEther('0'),
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
        getAddress(signer.address),
      );
      const signerAddress = await ethers.provider.getSigner().getAddress();

      const merkleTree = new MerkleTree(accounts, keccak256, {
        sortPairs: true,
        hashLeaves: true,
      });
      const root = merkleTree.getHexRoot();
      const proof = merkleTree.getHexProof(keccak256(signerAddress));

      const block = await ethers.provider.getBlock(
        await ethers.provider.getBlockNumber(),
      );
      // +10 is a number bigger than the count of transactions up to mint
      const stageStart = block.timestamp + 10;
      // Set stages
      await contract.setStages([
        {
          price: ethers.utils.parseEther('0.5'),
          mintFee: ethers.utils.parseEther('0'),
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
        value: ethers.utils.parseEther('0.5'),
      });
      const totalMinted = await contract.totalMintedByAddress(signerAddress);
      expect(totalMinted.toNumber()).to.equal(1);

      // Mint 1 token with someone's else proof should be reverted
      await expect(
        readonlyContract.mint(1, proof, 0, '0x00', {
          value: ethers.utils.parseEther('0.5'),
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
          mintFee: ethers.utils.parseEther('0'),
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

    it('crossmint', async () => {
      const crossmintAddressStr = '0xdAb1a1854214684acE522439684a145E62505233';
      const ERC721M = await ethers.getContractFactory('ERC721M');
      const erc721M = await ERC721M.deploy(
        'Test',
        'TEST',
        '',
        1000,
        0,
        ethers.constants.AddressZero,
        60,
        ethers.constants.AddressZero,
      );
      await erc721M.deployed();

      [owner, readonly] = await ethers.getSigners();
      const ownerConn = erc721M.connect(owner);
      const block = await ethers.provider.getBlock(
        await ethers.provider.getBlockNumber(),
      );
      // +10 is a number bigger than the count of transactions up to mint
      const stageStart = block.timestamp + 10;
      // Set stages
      await ownerConn.setStages([
        {
          price: ethers.utils.parseEther('0.5'),
          mintFee: ethers.utils.parseEther('0'),
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
      const crossmintSigner = await ethers.getImpersonatedSigner(
        crossmintAddressStr,
      );
      const crossmintAddress = await crossmintSigner.getAddress();

      // Send some wei to impersonated account
      await ethers.provider.send('hardhat_setBalance', [
        crossmintAddress,
        '0xFFFFFFFFFFFFFFFF',
      ]);

      const crossMintConn = erc721M.connect(crossmintSigner);

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

    it('crossmint with cosign', async () => {
      const crossmintAddressStr = '0xdAb1a1854214684acE522439684a145E62505233';
      [owner, readonly] = await ethers.getSigners();
      const ERC721M = await ethers.getContractFactory('ERC721M');
      const erc721M = await ERC721M.deploy(
        'Test',
        'TEST',
        '',
        1000,
        0,
        owner.address,
        300,
        ethers.constants.AddressZero,
      );
      await erc721M.deployed();

      const ownerConn = erc721M.connect(owner);
      const block = await ethers.provider.getBlock(
        await ethers.provider.getBlockNumber(),
      );
      await ownerConn.setStages([
        {
          price: ethers.utils.parseEther('0.5'),
          mintFee: ethers.utils.parseEther('0'),
          walletLimit: 0,
          merkleRoot: ethers.utils.hexZeroPad('0x', 32),
          maxStageSupply: 100,
          startTimeUnixSeconds: block.timestamp,
          endTimeUnixSeconds: block.timestamp + 1000,
        },
      ]);
      await ownerConn.setMintable(true);
      await ownerConn.setCrossmintAddress(crossmintAddressStr);

      // Impersonate Crossmint wallet
      const crossmintSigner = await ethers.getImpersonatedSigner(
        crossmintAddressStr,
      );
      const crossmintAddress = await crossmintSigner.getAddress();

      // Send some wei to impersonated account
      await ethers.provider.send('hardhat_setBalance', [
        crossmintAddress,
        '0xFFFFFFFFFFFFFFFF',
      ]);

      const crossMintConn = erc721M.connect(crossmintSigner);

      // fast forward 2 minutes, timestamp should still be valid since crossmint is the sender
      await ethers.provider.send('evm_mine', [block.timestamp + 120]);
      const twoMinuteOldTimestamp = block.timestamp;
      const signature = await getCosignSignature(
        erc721M,
        owner,
        crossmintSigner.address,
        twoMinuteOldTimestamp,
        1,
      );

      await crossMintConn.crossmint(
        1,
        readonly.address,
        [ethers.utils.hexZeroPad('0x', 32)],
        twoMinuteOldTimestamp,
        signature,
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
          mintFee: ethers.utils.parseEther('0.05'),
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
          mintFee: ethers.utils.parseEther('0.05'),
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
          mintFee: ethers.utils.parseEther('0.05'),
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
          mintFee: ethers.utils.parseEther('0.05'),
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
          mintFee: ethers.utils.parseEther('0.05'),
          walletLimit: 10,
          merkleRoot: ethers.utils.hexZeroPad('0x0', 32),
          maxStageSupply: 5,
          startTimeUnixSeconds: stageStart,
          endTimeUnixSeconds: stageStart + 1,
        },
        {
          price: ethers.utils.parseEther('0.6'),
          mintFee: ethers.utils.parseEther('0.06'),
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
          mintFee: ethers.utils.parseEther('0.05'),
          walletLimit: 10,
          merkleRoot: ethers.utils.hexZeroPad('0x0', 32),
          maxStageSupply: 5,
          startTimeUnixSeconds: stageStart,
          endTimeUnixSeconds: stageStart + 1,
        },
        {
          price: ethers.utils.parseEther('0.6'),
          mintFee: ethers.utils.parseEther('0.06'),
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

      expect(await contract.tokenURI(0)).to.equal('base_uri_0');
      expect(await contract.tokenURI(1)).to.equal('base_uri_1');

      await expect(contract.tokenURI(2)).to.be.revertedWith(
        'URIQueryForNonexistentToken',
      );
    });

    it('Returns should not be able to set baseURI once frozen', async () => {
      const block = await ethers.provider.getBlock(
        await ethers.provider.getBlockNumber(),
      );
      // +10 is a number bigger than the count of transactions up to mint
      const stageStart = block.timestamp + 10;
      // Set stages
      await contract.setStages([
        {
          price: ethers.utils.parseEther('0.5'),
          mintFee: ethers.utils.parseEther('0.05'),
          walletLimit: 10,
          merkleRoot: ethers.utils.hexZeroPad('0x0', 32),
          maxStageSupply: 5,
          startTimeUnixSeconds: stageStart,
          endTimeUnixSeconds: stageStart + 1,
        },
        {
          price: ethers.utils.parseEther('0.6'),
          mintFee: ethers.utils.parseEther('0.06'),
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

      expect(await contract.tokenURI(0)).to.equal('base_uri_0');
      expect(await contract.tokenURI(1)).to.equal('base_uri_1');

      await contract.setBaseURI('base_uri_again_');
      expect(await contract.tokenURI(0)).to.equal('base_uri_again_0');

      // readonlyContract should not be able to set baseURI
      await expect(
        readonlyContract.setBaseURI('something_else_'),
      ).to.be.revertedWith('Ownable');

      await expect(contract.setBaseURIPermanent()).to.emit(
        contract,
        'PermanentBaseURI',
      );
      await expect(
        contract.setBaseURI('base_uri_again_again_'),
      ).to.be.revertedWith('CannotUpdatePermanentBaseURI');
    });
  });

  describe('Global wallet limit', function () {
    it('validates global wallet limit in constructor', async () => {
      const ERC721M = await ethers.getContractFactory('ERC721M');
      await expect(
        ERC721M.deploy(
          'Test',
          'TEST',
          '',
          100,
          1001,
          ethers.constants.AddressZero,
          60,
          ethers.constants.AddressZero,
        ),
      ).to.be.revertedWith('GlobalWalletLimitOverflow');
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
          mintFee: ethers.utils.parseEther('0.01'),
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
        value: ethers.utils.parseEther('0.22'),
      });

      await expect(
        contract.mint(1, [ethers.utils.hexZeroPad('0x', 32)], 0, '0x00', {
          value: ethers.utils.parseEther('0.11'),
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
          mintFee: ethers.utils.parseEther('0.01'),
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
        value: ethers.utils.parseEther('0.11'),
      });

      const tokenUri = await contract.tokenURI(0);
      expect(tokenUri).to.equal(
        'ipfs://bafybeidntqfipbuvdhdjosntmpxvxyse2dkyfpa635u4g6txruvt5qf7y4/0.json',
      );
    });
  });

  describe('Cosign', () => {
    it('can deploy with 0x0 cosign', async () => {
      const [owner, cosigner] = await ethers.getSigners();
      const ERC721M = await ethers.getContractFactory('ERC721M');
      const erc721M = await ERC721M.deploy(
        'Test',
        'TEST',
        '',
        1000,
        0,
        ethers.constants.AddressZero,
        60,
        ethers.constants.AddressZero,
      );
      await erc721M.deployed();
      const ownerConn = erc721M.connect(owner);
      await expect(
        ownerConn.getCosignDigest(owner.address, 1, 0),
      ).to.be.revertedWith('CosignerNotSet');

      // we can set the cosigner
      await ownerConn.setCosigner(cosigner.address);

      // readonly contract can't set cosigner
      await expect(
        readonlyContract.setCosigner(cosigner.address),
      ).to.be.revertedWith('Ownable');
    });

    it('can deploy with cosign', async () => {
      const [_, minter, cosigner] = await ethers.getSigners();
      const ERC721M = await ethers.getContractFactory('ERC721M');
      const erc721M = await ERC721M.deploy(
        'Test',
        'TEST',
        '',
        1000,
        0,
        cosigner.address,
        60,
        ethers.constants.AddressZero,
      );
      await erc721M.deployed();

      const minterConn = erc721M.connect(minter);
      const timestamp = Math.floor(new Date().getTime() / 1000);
      const sig = await getCosignSignature(
        erc721M,
        cosigner,
        minter.address,
        timestamp,
        1,
      );
      await expect(
        minterConn.assertValidCosign(minter.address, 1, timestamp, sig),
      ).to.not.be.reverted;

      const invalidSig = sig + '00';
      await expect(
        minterConn.assertValidCosign(minter.address, 1, timestamp, invalidSig),
      ).to.be.revertedWith('InvalidCosignSignature');
    });
  });
});
