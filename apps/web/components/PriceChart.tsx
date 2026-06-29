"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useMarkPrice } from "@/store/marketStore";
import { Panel, PanelHeader } from "@/components/ui";

export function PriceChart({ symbol }: { symbol?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const markPrice = useMarkPrice(symbol)?.mark ?? null;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      width: el.clientWidth,
      height: el.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#848e9c",
      },
      grid: {
        vertLines: { color: "#2b3139" },
        horzLines: { color: "#2b3139" },
      },
      rightPriceScale: { borderColor: "#2b3139" },
      timeScale: {
        borderColor: "#2b3139",
        timeVisible: true,
        secondsVisible: true,
      },
      crosshair: { mode: 0 },
    });

    const series = chart.addLineSeries({
      color: "#f0b90b",
      lineWidth: 2,
      priceLineVisible: true,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!markPrice || !seriesRef.current) return;
    const value = Number(markPrice);
    if (!Number.isFinite(value)) return;
    seriesRef.current.update({
      time: Math.floor(Date.now() / 1000) as UTCTimestamp,
      value,
    });
  }, [markPrice]);

  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader>{symbol ? `${symbol} · Mark Price` : "Mark Price"}</PanelHeader>
      <div className="relative flex-1">
        <div ref={containerRef} className="absolute inset-0" />
        {!markPrice ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-dim">
            Waiting for price feed…
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
