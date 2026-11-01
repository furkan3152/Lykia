// Hardhat config for @lykia/contracts.
// Unit tests run on the in-process chain. `LYKIA_FORK=1` forks Arc testnet (chain 5042002) for the
// optional fork test. No live network has accounts configured: nothing here can broadcast.
require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");

const FORK = process.env.LYKIA_FORK === "1";
const ARC_TESTNET_RPC = process.env.ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.io";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: require("./solidity.config.cjs"),
  networks: {
    hardhat: {
      hardfork: "cancun",
      chainId: FORK ? 5042002 : 31337,
      ...(FORK ? { forking: { url: ARC_TESTNET_RPC } } : {}),
      chains: { 5042002: { hardforkHistory: { london: 0, merge: 0, shanghai: 0, cancun: 0 } } },
    },
  },
  mocha: { timeout: 600000 },
  paths: { sources: "./contracts", tests: "./test", cache: "./cache", artifacts: "./artifacts" },
};
