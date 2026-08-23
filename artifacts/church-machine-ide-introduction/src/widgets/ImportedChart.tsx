import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';

interface ImportedSeries {
  name: string;
  categories?: Array<string>;
  values: Array<number | null>;
  xValues?: Array<number | null>;
  bubbleSizes?: Array<number | null>;
  color?: string;
}

interface ImportedChartModel {
  type:
    | 'bar'
    | 'column'
    | 'line'
    | 'area'
    | 'pie'
    | 'doughnut'
    | 'scatter'
    | 'radar'
    | 'bubble';
  title?: string;
  series: Array<ImportedSeries>;
  grouping?: 'clustered' | 'stacked' | 'percentStacked' | 'standard';
  holeSize?: number;
}

const palette = [
  '#5470C6',
  '#91CC75',
  '#FAC858',
  '#EE6666',
  '#73C0DE',
  '#3BA272',
  '#FC8452',
  '#9A60B4',
  '#EA7CCC',
];

function seriesKey(index: number): string {
  return `series-${index}`;
}

function seriesColor(series: ImportedSeries, index: number): string {
  return series.color ?? palette[index % palette.length];
}

function chartRows(chart: ImportedChartModel) {
  const categories = chart.series[0]?.categories ?? [];
  const percent = chart.grouping === 'percentStacked';

  return categories.map((category, index) => {
    const values = chart.series.map((series) => series.values[index] ?? null);
    const total = values.reduce(
      (sum: number, value) => sum + Math.abs(value ?? 0),
      0,
    );
    const scale = percent && total > 0 ? 100 / total : 1;

    return {
      category,
      ...Object.fromEntries(
        values.map((value, seriesIndex) => [
          seriesKey(seriesIndex),
          value === null ? null : value * scale,
        ]),
      ),
    };
  });
}

export default function ImportedChart({
  chart,
}: {
  chart: ImportedChartModel;
}) {
  const isPercent = chart.grouping === 'percentStacked';
  const stackId =
    chart.grouping === 'stacked' || isPercent ? 'stack' : undefined;
  const rows = chartRows(chart);
  const common = {
    data: rows,
    margin: { top: 12, right: 20, bottom: 12, left: 4 },
  };
  const percentTick = isPercent
    ? (value: number) => `${value}%`
    : undefined;
  const decorations = (
    <>
      <Tooltip animationDuration={0} />
      {chart.series.length > 1 ? <Legend /> : null}
    </>
  );

  let graphic;
  if (chart.type === 'scatter' || chart.type === 'bubble') {
    graphic = (
      <ScatterChart margin={common.margin}>
        <CartesianGrid stroke="#E2E8F0" strokeDasharray="4 4" />
        <XAxis type="number" dataKey="x" tickLine={false} axisLine={false} />
        <YAxis type="number" dataKey="y" tickLine={false} axisLine={false} />
        {chart.type === 'bubble' ? (
          <ZAxis dataKey="z" range={[64, 400]} />
        ) : null}
        {decorations}
        {chart.series.map((series, index) => (
          <Scatter
            key={seriesKey(index)}
            name={series.name}
            data={series.values.flatMap((y, pointIndex) => {
              const x = series.xValues?.length
                ? (series.xValues[pointIndex] ?? null)
                : pointIndex + 1;
              const z = series.bubbleSizes?.length
                ? (series.bubbleSizes[pointIndex] ?? null)
                : 1;
              if (
                y === null ||
                x === null ||
                (chart.type === 'bubble' && z === null)
              ) {
                return [];
              }

              return [{ x, y, z: z ?? 1 }];
            })}
            fill={seriesColor(series, index)}
            isAnimationActive={false}
          />
        ))}
      </ScatterChart>
    );
  } else if (chart.type === 'line') {
    graphic = (
      <LineChart {...common}>
        <CartesianGrid
          stroke="#E2E8F0"
          strokeDasharray="4 4"
          vertical={false}
        />
        <XAxis dataKey="category" tickLine={false} axisLine={false} />
        <YAxis tickLine={false} axisLine={false} tickFormatter={percentTick} />
        {decorations}
        {chart.series.map((series, index) => (
          <Line
            key={seriesKey(index)}
            dataKey={seriesKey(index)}
            name={series.name}
            stroke={seriesColor(series, index)}
            strokeWidth={3}
            dot
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    );
  } else if (chart.type === 'area') {
    graphic = (
      <AreaChart {...common}>
        <CartesianGrid
          stroke="#E2E8F0"
          strokeDasharray="4 4"
          vertical={false}
        />
        <XAxis dataKey="category" tickLine={false} axisLine={false} />
        <YAxis tickLine={false} axisLine={false} tickFormatter={percentTick} />
        {decorations}
        {chart.series.map((series, index) => (
          <Area
            key={seriesKey(index)}
            dataKey={seriesKey(index)}
            name={series.name}
            stroke={seriesColor(series, index)}
            fill={seriesColor(series, index)}
            fillOpacity={0.24}
            stackId={stackId}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    );
  } else if (chart.type === 'pie' || chart.type === 'doughnut') {
    const series = chart.series[0];
    const data = (series?.categories ?? []).flatMap((name, index) => {
      const value = series?.values[index] ?? null;

      return value === null ? [] : [{ name, value }];
    });
    graphic = (
      <PieChart>
        <Tooltip animationDuration={0} />
        <Legend />
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={
            chart.type === 'doughnut'
              ? `${Math.min(chart.holeSize ?? 50, 75)}%`
              : 0
          }
          outerRadius="80%"
          isAnimationActive={false}
        >
          {data.map((entry, index) => (
            <Cell
              key={`${entry.name}-${index}`}
              fill={palette[index % palette.length]}
            />
          ))}
        </Pie>
      </PieChart>
    );
  } else if (chart.type === 'bar') {
    graphic = (
      <BarChart {...common} layout="vertical">
        <CartesianGrid
          stroke="#E2E8F0"
          strokeDasharray="4 4"
          horizontal={false}
        />
        <XAxis
          type="number"
          tickLine={false}
          axisLine={false}
          tickFormatter={percentTick}
        />
        <YAxis
          type="category"
          dataKey="category"
          tickLine={false}
          axisLine={false}
        />
        {decorations}
        {chart.series.map((series, index) => (
          <Bar
            key={seriesKey(index)}
            dataKey={seriesKey(index)}
            name={series.name}
            fill={seriesColor(series, index)}
            stackId={stackId}
            radius={[0, 6, 6, 0]}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    );
  } else {
    if (chart.type !== 'column' && chart.type !== 'radar') {
      throw new Error(`Unsupported imported chart type: ${chart.type}`);
    }
    graphic = (
      <BarChart {...common}>
        <CartesianGrid
          stroke="#E2E8F0"
          strokeDasharray="4 4"
          vertical={false}
        />
        <XAxis dataKey="category" tickLine={false} axisLine={false} />
        <YAxis tickLine={false} axisLine={false} tickFormatter={percentTick} />
        {decorations}
        {chart.series.map((series, index) => (
          <Bar
            key={seriesKey(index)}
            dataKey={seriesKey(index)}
            name={series.name}
            fill={seriesColor(series, index)}
            stackId={stackId}
            radius={[6, 6, 0, 0]}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    );
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      {chart.title ? (
        <div
          style={{
            height: 44,
            fontSize: 24,
            fontWeight: 700,
            color: '#0F172A',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {chart.title}
        </div>
      ) : null}
      <div
        style={{
          width: '100%',
          height: chart.title ? 'calc(100% - 44px)' : '100%',
        }}
      >
        <ResponsiveContainer width="100%" height="100%">
          {graphic}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
