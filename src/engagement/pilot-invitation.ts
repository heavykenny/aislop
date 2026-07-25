import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const STATE_BASENAME = "pilot_invitation.scans";
const INVITATION_SCAN_THRESHOLD = 3;
const PRIVATE_FILE_MODE = 0o600;
const SCAN_RECORD = "1\n";
const MAX_COUNTER_BYTES = 4096;

const resolvePilotInvitationStatePath = (
	homedir: string = os.homedir(),
	env: NodeJS.ProcessEnv = process.env,
): string => {
	if (process.platform === "linux" && env.XDG_STATE_HOME) {
		return path.join(env.XDG_STATE_HOME, "aislop", STATE_BASENAME);
	}
	return path.join(homedir, ".aislop", STATE_BASENAME);
};

const readCounter = (fileDescriptor: number, size: number): string => {
	const buffer = Buffer.alloc(size);
	if (size > 0) {
		fs.readSync(fileDescriptor, buffer, 0, size, 0);
	}
	return buffer.toString("utf8");
};

const resolveNoFollowFlag = (): number | null => {
	const value: unknown = Reflect.get(fs.constants, "O_NOFOLLOW");
	return typeof value === "number" && value !== 0 ? value : null;
};

const ensureStateDirectory = (directory: string): boolean => {
	try {
		if (!fs.existsSync(directory)) {
			fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
		}
		const stat = fs.lstatSync(directory);
		if (!stat.isDirectory()) return false;
		if ((stat.mode & 0o777) !== 0o700) {
			fs.chmodSync(directory, 0o700);
		}
		return true;
	} catch {
		return false;
	}
};

const appendScan = (statePath: string, noFollowFlag: number | null): number | null => {
	if (noFollowFlag === null) return null;
	let fileDescriptor: number | undefined;
	try {
		if (!ensureStateDirectory(path.dirname(statePath))) return null;
		const flags = fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_RDWR | noFollowFlag;
		fileDescriptor = fs.openSync(statePath, flags, PRIVATE_FILE_MODE);
		const initialStat = fs.fstatSync(fileDescriptor);
		if (!initialStat.isFile() || initialStat.size > MAX_COUNTER_BYTES) return null;
		fs.fchmodSync(fileDescriptor, PRIVATE_FILE_MODE);

		const existing = readCounter(fileDescriptor, initialStat.size);
		if (!/^(1\n)*$/.test(existing)) return null;

		fs.writeSync(fileDescriptor, SCAN_RECORD);
		fs.fsyncSync(fileDescriptor);
		const finalSize = fs.fstatSync(fileDescriptor).size;
		return Math.floor(finalSize / Buffer.byteLength(SCAN_RECORD));
	} catch {
		return null;
	} finally {
		if (fileDescriptor !== undefined) {
			fs.closeSync(fileDescriptor);
		}
	}
};

const claimInvitation = (statePath: string): boolean => {
	const claimPath = `${statePath}.shown`;
	try {
		fs.writeFileSync(claimPath, "", {
			flag: "wx",
			mode: PRIVATE_FILE_MODE,
		});
		fs.chmodSync(claimPath, PRIVATE_FILE_MODE);
		return true;
	} catch {
		return false;
	}
};

const invitationAlreadyClaimed = (statePath: string): boolean => {
	const claimPath = `${statePath}.shown`;
	try {
		return fs.lstatSync(claimPath).isFile();
	} catch {
		return false;
	}
};

export const recordCompletedFullScan = (
	statePath: string = resolvePilotInvitationStatePath(),
	noFollowFlag: number | null = resolveNoFollowFlag(),
): boolean => {
	if (invitationAlreadyClaimed(statePath)) return false;
	const completedFullScans = appendScan(statePath, noFollowFlag);
	return (
		completedFullScans !== null &&
		completedFullScans >= INVITATION_SCAN_THRESHOLD &&
		claimInvitation(statePath)
	);
};
