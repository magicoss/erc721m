import { ERC721MOnft } from '../typechain-types';
import { Contract, Signer } from 'ethers';
import { ethers } from 'hardhat';
import { expect } from 'chai';

describe('ERC721MOnft Test', () => {
  let contract: ERC721MOnft;
  let lzEndpoint: Contract;
  let owner: Signer;
  let minter: Signer;

  const mintPrice = 50;
  const targetChainId = 10109;  // mumbnai
  const targetAddress = '0x15f963ae86e562535a1546f9417b604e29fe78f6';  // a random address 

  describe('mint and bridge', function () {
    beforeEach(async function () {
      // Deploy the mock LayerZero endpoint contract that will be used for minting
      const MockLayerZeroEndpoint = await ethers.getContractFactory('MockLayerZeroEndpoint');
      lzEndpoint = await MockLayerZeroEndpoint.deploy();
      await lzEndpoint.deployed();

      // Deploy the ERC721M contract
      const ERC721MOnft = await ethers.getContractFactory('ERC721MOnft');
      const erc721MOnft = await ERC721MOnft.deploy(
        'Test',
        'TEST',
        '',
        1000,
        0,
        ethers.constants.AddressZero,
        60,
        15000,
        lzEndpoint.address
      );
      await erc721MOnft.deployed();

      [owner, minter] = await ethers.getSigners();

      contract = erc721MOnft.connect(owner);

      const block = await ethers.provider.getBlock(
        await ethers.provider.getBlockNumber(),
      );
      // +10 is a number bigger than the count of transactions up to mint
      const stageStart = block.timestamp + 10;
      // Set stages
      await contract.setStages([
        {
          price: mintPrice,
          mintFee: 0,
          walletLimit: 0,
          merkleRoot: ethers.utils.hexZeroPad('0x0', 32),
          maxStageSupply: 5,
          startTimeUnixSeconds: stageStart,
          endTimeUnixSeconds: stageStart + 10000,
        },
      ]);
      await contract.setMaxMintableSupply(999);
      await contract.setMintable(true);

      // Setup the test context: Update block.timestamp to comply to the stage being active
      await ethers.provider.send('evm_mine', [stageStart - 1]);
    });

    it('happy case', async function () {
      await contract.setMinDstGas(targetChainId, 1, 15000);

      const remoteAndLocal = ethers.utils.solidityPack(
        ['address', 'address'],
        [targetAddress, contract.address]
      );
      await contract.setTrustedRemote(targetChainId, remoteAndLocal);

      await contract.mint(2, [ethers.utils.hexZeroPad('0x', 32)], 0, '0x00', {
        value: ethers.utils.parseEther('50'),
      });

      const [stageInfo, walletMintedCount, stagedMintedCount] =
        await contract.getStageInfo(0);
      expect(walletMintedCount).to.equal(2);
      expect(stagedMintedCount.toNumber()).to.equal(2);

      const adapterParams = ethers.utils.solidityPack(["uint16", "uint256"], [1, 200000]) // default adapterParams example
      const fees = await contract.estimateSendFee(targetChainId, owner.getAddress(), 0, /* useZro= */false, adapterParams);
      const nativeFee = fees[0];

      await contract.sendFrom(owner.getAddress(), targetChainId, owner.getAddress(), 0, owner.getAddress(), ethers.constants.AddressZero, adapterParams, { value: nativeFee.mul(5).div(4) })
    });

    it('bridge fails if min destination gas not set', async function () {
      await contract.mint(1, [ethers.utils.hexZeroPad('0x', 32)], 0, '0x00', {
        value: ethers.utils.parseEther('50'),
      });

      const adapterParams = ethers.utils.solidityPack(["uint16", "uint256"], [1, 200000]) // default adapterParams example
      const fees = await contract.estimateSendFee(targetChainId, owner.getAddress(), 0, /* useZro= */false, adapterParams);
      const nativeFee = fees[0];

      await expect(contract.sendFrom(owner.getAddress(), targetChainId, owner.getAddress(), 0, owner.getAddress(), ethers.constants.AddressZero, adapterParams, { value: nativeFee.mul(5).div(4) })
      ).to.be.revertedWith('minGasLimit not set');
    });

    it('bridge fails if the token not exist', async function () {
      const adapterParams = ethers.utils.solidityPack(["uint16", "uint256"], [1, 200000]) // default adapterParams example
      const fees = await contract.estimateSendFee(targetChainId, owner.getAddress(), 0, /* useZro= */false, adapterParams);
      const nativeFee = fees[0];

      await expect(contract.sendFrom(owner.getAddress(), targetChainId, owner.getAddress(), 0, owner.getAddress(), ethers.constants.AddressZero, adapterParams, { value: nativeFee.mul(5).div(4) })
      ).to.be.revertedWith('OwnerQueryForNonexistentToken');
    });


    it('bridge fails if the destination chain not trusted', async function () {
      await contract.setMinDstGas(targetChainId, 1, 15000);

      await contract.mint(1, [ethers.utils.hexZeroPad('0x', 32)], 0, '0x00', {
        value: ethers.utils.parseEther('50'),
      });

      const adapterParams = ethers.utils.solidityPack(["uint16", "uint256"], [1, 200000]) // default adapterParams example
      const fees = await contract.estimateSendFee(targetChainId, owner.getAddress(), 0, /* useZro= */false, adapterParams);
      const nativeFee = fees[0];

      await expect(contract.sendFrom(owner.getAddress(), targetChainId, owner.getAddress(), 0, owner.getAddress(), ethers.constants.AddressZero, adapterParams, { value: nativeFee.mul(5).div(4) })
      ).to.be.revertedWith('destination chain not a trusted source');
    });
  });
});
