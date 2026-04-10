export async function fetchUsgsFlow(gaugeId: string, date: string): Promise<number | null> {
	try {
		const startDate = date;
		const endDate = date;
		const url = `https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${gaugeId}&startDT=${startDate}&endDT=${endDate}&parameterCd=00060&siteStatus=all`;

		const response = await fetch(url);
		if (!response.ok) return null;

		const data = await response.json();
		const timeSeries = data?.value?.timeSeries;
		if (!timeSeries || timeSeries.length === 0) return null;

		const values = timeSeries[0]?.values?.[0]?.value;
		if (!values || values.length === 0) return null;

		// Get the value closest to midday
		const targetHour = 12;
		let closest = values[0];
		let minDiff = Infinity;

		for (const v of values) {
			const hour = new Date(v.dateTime).getHours();
			const diff = Math.abs(hour - targetHour);
			if (diff < minDiff) {
				minDiff = diff;
				closest = v;
			}
		}

		const flow = parseFloat(closest.value);
		return isNaN(flow) || flow < 0 ? null : flow;
	} catch {
		return null;
	}
}
