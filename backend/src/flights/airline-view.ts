import type {
  AirlineDocument,
  CancellationTier,
} from './schemas/airline.schema';

export interface AirlineView {
  id: string;
  name: string;
  code: string;
  logoUrl: string | null;
  isActive: boolean;
  baggagePolicy: { extraBagPrice: number; maxExtraBags: number } | null;
  cancellationPolicy: CancellationTier[];
}

export function toAirlineView(airline: AirlineDocument): AirlineView {
  return {
    id: airline.id,
    name: airline.name,
    code: airline.code,
    logoUrl: airline.logoUrl ?? null,
    isActive: airline.isActive,
    baggagePolicy: airline.baggagePolicy
      ? {
          extraBagPrice: airline.baggagePolicy.extraBagPrice,
          maxExtraBags: airline.baggagePolicy.maxExtraBags,
        }
      : null,
    cancellationPolicy: airline.cancellationPolicy.map((tier) => ({
      daysBefore: tier.daysBefore,
      refundPercent: tier.refundPercent,
    })),
  };
}
