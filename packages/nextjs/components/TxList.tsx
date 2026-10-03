import { HashScanLink } from "./HashScanLink";
import type { Hash } from "viem";

type TxListProps = {
  hashes: readonly Hash[];
};

/** The transactions a panel has sent this session, newest first, each linked to HashScan once confirmed. */
export const TxList = ({ hashes }: TxListProps) => {
  if (hashes.length === 0) return null;
  return (
    <div className="text-xs text-base-content/70">
      <p className="m-0 mb-1 font-medium">Confirmed transactions</p>
      <ul className="m-0 list-none p-0 space-y-0.5">
        {[...hashes].reverse().map(hash => (
          <li key={hash}>
            <HashScanLink kind="tx" value={hash} />
          </li>
        ))}
      </ul>
    </div>
  );
};
