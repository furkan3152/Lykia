// Compiler settings shared by hardhat.config.cjs and scripts/export.cjs.
// Cancun opcodes only: Arc's Reth execution layer supports them; newer forks are not relied on.
module.exports = {
  version: "0.8.28",
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "cancun",
    viaIR: false,
    metadata: { bytecodeHash: "ipfs" },
  },
};
