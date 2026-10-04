// solidity-coverage: measure Verdict, ChainlinkResolver and VerdictRouter only. Mocks and  are
// test scaffolding, interfaces and the code library hold no executable lines.
module.exports = {
  skipFiles: ["mocks", "", "interfaces", "libraries"],
  istanbulReporter: ["text", "text-summary"],
  mocha: {
    timeout: 600000,
  },
};
