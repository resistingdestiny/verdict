// solidity-coverage: measure Verdict, ChainlinkResolver and VerdictRouter only. Mocks and spikes are
// test scaffolding, interfaces and the code library hold no executable lines.
module.exports = {
  skipFiles: ["mocks", "spikes", "interfaces", "libraries"],
  istanbulReporter: ["text", "text-summary"],
  mocha: {
    timeout: 600000,
  },
};
