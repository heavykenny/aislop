import { Text } from "ink";
import { useEffect, useState } from "react";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export const Spinner = ({ color }: { color?: string }) => {
	const [frame, setFrame] = useState(0);
	useEffect(() => {
		const timer = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), 80);
		return () => clearInterval(timer);
	}, []);
	return <Text color={color}>{FRAMES[frame]}</Text>;
};
