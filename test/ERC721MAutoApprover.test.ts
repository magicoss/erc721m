import { ERC721MAutoApprover } from '../typechain-types';
import { ethers } from 'hardhat';
import { expect } from 'chai';

const test_approve_address = '0x7897018b1cE161e58943C579AC3df50d89c3D4F4';

describe('ERC721MAutoApprover', () => {
  let contract: ERC721MAutoApprover;

  beforeEach(async () => {
    const factory = await ethers.getContractFactory('ERC721MAutoApprover');
    contract = await factory.deploy(
      'test',
      'TEST',
      '.json',
      1000,
      0,
      ethers.constants.AddressZero,
      300,
      ethers.constants.AddressZero,
      test_approve_address,
    );
    const [owner] = await ethers.getSigners();
    contract = contract.connect(owner);
    await contract.deployed();
  });

  it('can set approval for all if the auto approver is used', async () => {
    const [owner] = await ethers.getSigners();
    const block = await ethers.provider.getBlock(
      await ethers.provider.getBlockNumber(),
    );
    // +10 is a number bigger than the count of transactions up to mint
    const stageStart = block.timestamp + 10;
    // Set stages
    await contract.setStages([
      {
        price: ethers.utils.parseEther('0.5'),
        mintFee: ethers.utils.parseEther('0.5'),
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

    // no approval yet
    expect(
      await contract.isApprovedForAll(owner.getAddress(), test_approve_address),
    ).to.be.equal(false);

    // Mint 1 token
    await contract.mint(1, [ethers.utils.hexZeroPad('0x', 32)], 0, '0x00', {
      value: ethers.utils.parseEther('1'),
    });

    // approval should be set
    expect(
      await contract.isApprovedForAll(owner.getAddress(), test_approve_address),
    ).to.be.equal(true);
  });

  it('do not set approval for all if the auto approver is turned off', async () => {
    const [owner] = await ethers.getSigners();
    const block = await ethers.provider.getBlock(
      await ethers.provider.getBlockNumber(),
    );
    // +10 is a number bigger than the count of transactions up to mint
    const stageStart = block.timestamp + 10;
    // Set stages
    await contract.setStages([
      {
        price: ethers.utils.parseEther('0.5'),
        mintFee: ethers.utils.parseEther('0.5'),
        walletLimit: 0,
        merkleRoot: ethers.utils.hexZeroPad('0x0', 32),
        maxStageSupply: 100,
        startTimeUnixSeconds: stageStart,
        endTimeUnixSeconds: stageStart + 2,
      },
    ]);
    await contract.setMintable(true);

    // manually turn off the auto approver
    await contract.setAutoApproveAddress(ethers.constants.AddressZero);

    // Setup the test context: Update block.timestamp to comply to the stage being active
    await ethers.provider.send('evm_mine', [stageStart - 1]);

    // no approval yet
    expect(
      await contract.isApprovedForAll(owner.getAddress(), test_approve_address),
    ).to.be.equal(false);

    // Mint 1 token
    await contract.mint(1, [ethers.utils.hexZeroPad('0x', 32)], 0, '0x00', {
      value: ethers.utils.parseEther('1'),
    });

    // approval should not be set
    expect(
      await contract.isApprovedForAll(owner.getAddress(), test_approve_address),
    ).to.be.equal(false);
  });
});
