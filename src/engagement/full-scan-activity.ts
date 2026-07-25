import { isTelemetryDisabled, type TelemetryConfig } from "../telemetry/client.js";
import { type AppendHistoryInput, appendHistory, isHistoryDisabled } from "../utils/history.js";
import { recordCompletedFullScan } from "./pilot-invitation.js";

export const recordFullScanActivity = (
	history: AppendHistoryInput,
	allowPilotInvitation: boolean,
	telemetryConfig: TelemetryConfig,
): boolean => {
	appendHistory(history);
	return (
		allowPilotInvitation &&
		!isHistoryDisabled() &&
		!isTelemetryDisabled(telemetryConfig) &&
		recordCompletedFullScan()
	);
};
