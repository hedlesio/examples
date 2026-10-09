import { bitgo, ECPair, type Network, payments } from "@bitgo/utxo-lib";
import { fundingNetwork } from "../../src/swap.ts";

export interface FundingFixture {
  chain: string;
  network: Network;
  senderWif: string;
  senderHex: string;
  senderAddress: string;
  venueAddress: string;
  unsigned: string;
}

// What the venue hands back for a quote: a PSBT spending one legacy input the
// sender controls, paying the venue, with change back to the sender.
export function fundingFixture(chain: "bitcoin" | "litecoin" | "dogecoin", seed = 7): FundingFixture {
  const network = fundingNetwork(chain);
  const senderKey = ECPair.makeRandom({ network });
  const sender = payments.p2pkh({ pubkey: senderKey.publicKey, network });
  const venue = payments.p2pkh({ pubkey: ECPair.makeRandom({ network }).publicKey, network });
  if (!sender.output || !sender.address || !venue.address || !senderKey.privateKey) {
    throw new Error("fixture payment failed");
  }

  const previous = new bitgo.UtxoTransaction(network);
  previous.addInput(Buffer.alloc(32, seed), 0);
  previous.addOutput(sender.output, 100_000);

  const psbt = bitgo.createPsbtForNetwork({ network });
  psbt.addInput({ hash: previous.getId(), index: 0, nonWitnessUtxo: previous.toBuffer() });
  psbt.addOutput({ address: venue.address, value: 90_000n });
  psbt.addOutput({ address: sender.address, value: 9_000n });

  return {
    chain,
    network,
    senderWif: senderKey.toWIF(),
    senderHex: senderKey.privateKey.toString("hex"),
    senderAddress: sender.address,
    venueAddress: venue.address,
    unsigned: psbt.toBase64(),
  };
}
