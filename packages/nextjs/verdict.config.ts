/**
 * Verdict deployment config for the frontend, beyond the contract addresses in
 * contracts/deployedContracts.ts. hcsTopicId is null until the HCS topic is created;
 * the create-topic script rewrites the null below with the topic id and the app must
 * boot and render every route with the null in place.
 */
export type VerdictConfig = {
  hcsTopicId: string | null;
  mirrorNodeUrl: string;
  hashScanUrl: string;
};

const verdictConfig: VerdictConfig = {
  hcsTopicId: null,
  mirrorNodeUrl: "https://testnet.mirrornode.hedera.com",
  hashScanUrl: "https://hashscan.io/testnet",
};

export default verdictConfig;
