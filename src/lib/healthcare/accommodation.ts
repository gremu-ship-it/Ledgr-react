import type {
  AccommodationCoverageLine,
  AccommodationCoveragePolicy,
  AccommodationCoverageResult,
  InpatientStayCharge,
} from '@/types/healthcare';

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function clampPercent(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

/**
 * Split one bed stay between the payer and the patient.
 *
 * The HMO daily cap limits the rate the payer covers. When the room costs more
 * than the cap, the differential is either billed to the patient (upgrades) or
 * absorbed by the payer. The co-pay percentage is applied only to the covered
 * accommodation amount, never to the upgrade differential.
 */
export function calculateAccommodationCoverage(
  charges: readonly InpatientStayCharge[],
  policy: AccommodationCoveragePolicy = {},
): AccommodationCoverageResult {
  const copayRate = clampPercent(policy.copayPercent) / 100;
  const cap =
    typeof policy.dailyCap === 'number' && Number.isFinite(policy.dailyCap)
      ? Math.max(0, policy.dailyCap)
      : null;

  const lines: AccommodationCoverageLine[] = charges.map((charge) => {
    const nights = Math.max(1, Math.ceil(charge.nights));
    const dailyRate = roundMoney(Math.max(0, charge.dailyRate));
    const totalCharge = roundMoney(
      Number.isFinite(charge.totalCharge) ? charge.totalCharge : nights * dailyRate,
    );

    const capApplies = cap !== null && cap < dailyRate;
    const difference = capApplies ? roundMoney((dailyRate - (cap as number)) * nights) : 0;
    const upgradeDifferential =
      capApplies && policy.roomUpgradeChargeToPatient !== false ? difference : 0;
    const coveredAmount = capApplies
      ? roundMoney(totalCharge - difference)
      : totalCharge;
    const coveredDailyRate = nights > 0 ? roundMoney(coveredAmount / nights) : 0;
    const patientCopay = roundMoney(coveredAmount * copayRate);
    const patientShare = roundMoney(patientCopay + upgradeDifferential);
    const insurerShare = roundMoney(totalCharge - patientShare);

    return {
      ...charge,
      nights,
      totalCharge,
      coveredDailyRate,
      coveredAmount,
      upgradeDifferential,
      patientCopay,
      patientShare,
      insurerShare,
    };
  });

  return {
    lines,
    totalCharge: roundMoney(lines.reduce((total, line) => total + line.totalCharge, 0)),
    patientShare: roundMoney(lines.reduce((total, line) => total + line.patientShare, 0)),
    insurerShare: roundMoney(lines.reduce((total, line) => total + line.insurerShare, 0)),
    upgradeDifferential: roundMoney(
      lines.reduce((total, line) => total + line.upgradeDifferential, 0),
    ),
  };
}
