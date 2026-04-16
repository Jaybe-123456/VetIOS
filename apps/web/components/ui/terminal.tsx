// Updated terminal.tsx to improve text contrast and readability

const Terminal = () => {
    return (
        <div>
            {/* Other components */}
            <DataRow className="text-[11px] sm:text-[12px]">
                {/* Data row content */}
            </DataRow>
            <MetricCard className="text-lg xl:text-2xl 2xl:text-3xl">
                {/* Metric card content */}
            </MetricCard>
        </div>
    );
};

export default Terminal;