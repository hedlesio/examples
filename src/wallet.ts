import type { HedlesApi } from "./api.ts";
import { stampIdentity } from "./turnkey.ts";
import type { AddressEntry, CreateAddressResponse, Stamper } from "./types.ts";

type WalletApi = Pick<HedlesApi, "createAddress">;

function isPrepared(
  response: CreateAddressResponse,
): response is Extract<CreateAddressResponse, { prepared: object }> {
  return "prepared" in response;
}

export async function createWalletAddress(
  api: WalletApi,
  chainType: string,
  stamper: () => Stamper,
): Promise<AddressEntry> {
  const prepared = await api.createAddress(chainType);
  if (!isPrepared(prepared)) return prepared;

  const signedRequest = await stampIdentity(prepared.prepared.body, stamper());
  const created = await api.createAddress(chainType, signedRequest);
  if (isPrepared(created)) {
    throw new Error("Wallet address creation returned another unsigned Turnkey activity");
  }
  return created;
}
