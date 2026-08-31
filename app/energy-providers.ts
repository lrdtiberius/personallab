type EnergyProviderReference = { provider: string };

const normalizedWords = (value: string) => value
  .toLocaleLowerCase("de-DE")
  .replace(/ä/g, "ae")
  .replace(/ö/g, "oe")
  .replace(/ü/g, "ue")
  .replace(/ß/g, "ss")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .split(/[^a-z0-9]+/)
  .filter(word => word.length >= 3);

export function energyProviderNames(contracts: EnergyProviderReference[]) {
  return [...new Set(contracts.map(contract => contract.provider.trim()).filter(Boolean))];
}

export function inferEnergyProviderNames(providers: string[], groupLabel: string) {
  const groupWords = normalizedWords(groupLabel);
  if (!groupWords.length) return [];
  return providers.filter(provider => {
    const providerWords = normalizedWords(provider);
    return groupWords.some(groupWord => providerWords.some(providerWord => providerWord === groupWord || providerWord.startsWith(groupWord) || groupWord.startsWith(providerWord)));
  });
}

export function orderedEnergyContracts<T extends EnergyProviderReference>(contracts: T[], providers: string[]) {
  const providerOrder = new Map(providers.map((provider, index) => [provider, index]));
  return contracts
    .filter(contract => providerOrder.has(contract.provider))
    .map((contract, index) => ({ contract, index }))
    .sort((left, right) => (providerOrder.get(left.contract.provider) ?? 0) - (providerOrder.get(right.contract.provider) ?? 0) || left.index - right.index)
    .map(entry => entry.contract);
}
