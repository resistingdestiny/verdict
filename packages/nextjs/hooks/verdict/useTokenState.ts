import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { useReadContract } from "wagmi";
import { useTargetNetwork } from "~~/hooks/scaffold-hbar";
import { ZERO_ADDRESS, htsTokenAbi, isAssociatedOnMirror, isZeroAddress } from "~~/lib/hts";
import scaffoldConfig from "~~/scaffold.config";

type TokenStateArgs = {
  token: Address | undefined;
  owner: Address | undefined;
  spender?: Address;
};

/**
 * What the app must know before moving an HTS token for a wallet: its balance, whether the wallet is
 * associated with the token (from the mirror node, falling back to a non-zero balance when the mirror
 * node is unreachable) and, when a spender is given, the allowance that spender holds.
 */
export function useTokenState({ token, owner, spender }: TokenStateArgs) {
  const { targetNetwork } = useTargetNetwork();
  const enabled = Boolean(token && owner && !isZeroAddress(token));

  const balance = useReadContract({
    address: token,
    abi: htsTokenAbi,
    functionName: "balanceOf",
    args: [owner ?? ZERO_ADDRESS],
    chainId: targetNetwork.id,
    query: { enabled, refetchInterval: scaffoldConfig.pollingInterval },
  });

  const allowance = useReadContract({
    address: token,
    abi: htsTokenAbi,
    functionName: "allowance",
    args: [owner ?? ZERO_ADDRESS, spender ?? ZERO_ADDRESS],
    chainId: targetNetwork.id,
    query: { enabled: enabled && Boolean(spender), refetchInterval: scaffoldConfig.pollingInterval },
  });

  const association = useQuery({
    queryKey: ["verdict", "association", targetNetwork.id, token, owner],
    enabled,
    retry: 1,
    staleTime: 15_000,
    queryFn: () => isAssociatedOnMirror(owner as Address, token as Address),
  });

  let associated: boolean | undefined = association.data;
  if (associated === undefined && association.isError && balance.data !== undefined && balance.data > 0n) {
    associated = true;
  }

  const refetch = async () => {
    await Promise.all([balance.refetch(), allowance.refetch(), association.refetch()]);
  };

  return {
    balance: balance.data,
    allowance: allowance.data,
    associated,
    associationUnknown: association.isError && associated === undefined,
    isLoading: enabled && (balance.isLoading || association.isLoading),
    refetch,
  };
}
