import {
  Component,
  createContext,
  useContext,
  useId,
  useRef,
  type CSSProperties,
  type ElementType,
  type MouseEvent,
  type ReactNode,
} from 'react';
import {
  SDM_POINT_TO_UNIT,
  type Action,
  type Element,
  type JsonValue,
  type Paint,
  type RunStyle,
  type SlideDocument,
  type Stroke,
  type TextBody,
  type Theme,
} from './core/schema';
import {
  paragraphLayoutCss,
  paragraphMarkerCss,
} from './core/text/inlineStyles';
import { effectiveParagraph, paragraphMarkers } from './core/text';
import { elementTransform } from './geometry';
import { shapePathFor, type ShapePath } from './shapePaths';
import {
  paintToBackground,
  resolveAssetSrc,
  resolveColor,
  resolvePaint,
  sanitizeActionUrl,
  strokeToBorder,
  textRunStyle,
} from './style';
import {
  SdmTextEditor,
  type SdmTextEditorOptions,
} from './SdmTextEditor';

export type WidgetProps = Record<string, JsonValue>;
export type WidgetModule = Record<string, unknown>;

export interface SdmRenderContextValue {
  baseUrl: string;
  widgets: Record<string, WidgetModule>;
}

export const SdmRenderContext = createContext<SdmRenderContextValue>({
  baseUrl: '/',
  widgets: {},
});
function frameStyle(element: Element): CSSProperties {
  return {
    position: 'absolute',
    left: element.frame.x,
    top: element.frame.y,
    width: element.frame.width,
    height: element.frame.height,
    transform: elementTransform(element),
    opacity: element.opacity,
    display: element.hidden ? 'none' : undefined,
    transformOrigin: 'center center',
    boxSizing: 'border-box',
  };
}

function TextRunView({
  run,
  defaultRunStyle,
  theme,
  onAction,
}: {
  run: TextBody['paragraphs'][number]['runs'][number];
  defaultRunStyle: RunStyle | undefined;
  theme: Theme | undefined;
  onAction: ((action: Action) => void) | undefined;
}) {
  const content = run.text === '' ? '\u00a0' : run.text;
  const style = textRunStyle({ ...defaultRunStyle, ...run }, theme);
  if (run.action?.kind === 'openUrl') {
    const safeUrl = sanitizeActionUrl(run.action.url);
    if (!safeUrl) {
      return (
        <span data-sdm-text-run="" style={style}>
          {content}
        </span>
      );
    }

    return (
      <a
        href={safeUrl}
        target={run.action.target === 'sameWindow' ? '_self' : '_blank'}
        rel="noreferrer"
        data-sdm-action={JSON.stringify(run.action)}
        data-sdm-text-run=""
        style={style}
        onClick={(event) => event.stopPropagation()}
      >
        {content}
      </a>
    );
  }
  if (run.action) {
    const action = run.action;

    return (
      <span
        role="link"
        tabIndex={0}
        data-sdm-action={JSON.stringify(action)}
        data-sdm-text-run=""
        style={{ ...style, cursor: 'pointer' }}
        onClick={(event) => {
          event.stopPropagation();
          onAction?.(action);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          onAction?.(action);
        }}
      >
        {content}
      </span>
    );
  }

  return (
    <span data-sdm-text-run="" style={style}>
      {content}
    </span>
  );
}

export function TextBodyView({
  body,
  theme,
  onAction,
  textEditor,
}: {
  body: TextBody;
  theme?: Theme;
  onAction?: (action: Action) => void;
  textEditor?: SdmTextEditorOptions;
}) {
  let vertical = 'flex-start';
  if (body.verticalAlign === 'middle') {
    vertical = 'center';
  } else if (body.verticalAlign === 'bottom') {
    vertical = 'flex-end';
  }
  const inset = body.insetsPt;
  const contentRef = useRef<HTMLDivElement>(null);
  const effectiveParagraphs = body.paragraphs.map((paragraph) =>
    effectiveParagraph(paragraph),
  );
  const markers = paragraphMarkers(effectiveParagraphs);

  return (
    <div
      data-sdm-text-body=""
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: vertical,
        overflow: body.overflow === 'visible' ? 'visible' : 'hidden',
        padding: inset
          ? `${inset.top * SDM_POINT_TO_UNIT}px ${inset.right * SDM_POINT_TO_UNIT}px ${inset.bottom * SDM_POINT_TO_UNIT}px ${inset.left * SDM_POINT_TO_UNIT}px`
          : undefined,
        boxSizing: 'border-box',
      }}
    >
      <div ref={contentRef} data-sdm-text-content="">
        {textEditor === undefined ? (
          body.paragraphs.map((paragraph, index) => {
            const effective = effectiveParagraphs[index];
            const marker = markers[index] ?? '';
            const paragraphStyle = {
              ...effective.defaultRunStyle,
              ...paragraph.runs[0],
            };
            const hasMarker =
              effective.bullet?.kind === 'character' ||
              effective.bullet?.kind === 'number';

            return (
              <div
                key={index}
                data-sdm-text-paragraph-index={index}
                style={paragraphLayoutCss(effective)}
              >
                {hasMarker ? (
                  <span
                    data-sdm-text-marker=""
                    style={paragraphMarkerCss(effective, theme)}
                  >
                    {marker}
                  </span>
                ) : null}
                {paragraph.runs.map((run, runIndex) => (
                  <TextRunView
                    key={runIndex}
                    run={run}
                    defaultRunStyle={effective.defaultRunStyle}
                    theme={theme}
                    onAction={onAction}
                  />
                ))}
                {!hasMarker && paragraph.runs.length === 0 ? (
                  <span style={textRunStyle(paragraphStyle, theme)}>
                    {'\u200B'}
                  </span>
                ) : null}
              </div>
            );
          })
        ) : (
          <SdmTextEditor
            body={body}
            initialPoint={textEditor.initialPoint}
            mountRef={contentRef}
            onCancel={textEditor.onCancel}
            onCommit={textEditor.onCommit}
            onSelectionChange={textEditor.onSelectionChange}
            registerCommitHandler={textEditor.registerCommitHandler}
            registerCommandHandler={textEditor.registerCommandHandler}
            registerPlacementHandler={textEditor.registerPlacementHandler}
            theme={theme}
          />
        )}
      </div>
    </div>
  );
}

function gradientVector(angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(rad) / 2;
  const dy = -Math.cos(rad) / 2;

  return { x1: 0.5 - dx, y1: 0.5 - dy, x2: 0.5 + dx, y2: 0.5 + dy };
}

type ResolvedBackground = ReturnType<typeof paintToBackground>;

export function backgroundValue(
  resolved: ResolvedBackground,
): string | undefined {
  return resolved?.opacity === undefined ? resolved?.background : undefined;
}

export function PaintLayer({
  resolved,
}: {
  resolved: ResolvedBackground;
}) {
  if (!resolved || resolved.opacity === undefined) {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        background: resolved.background,
        opacity: resolved.opacity,
        pointerEvents: 'none',
      }}
    />
  );
}

function strokeDasharray(
  dash: Stroke['dash'],
  width: number,
): string | undefined {
  if (dash === 'dash') {
    return `${width * 3} ${width * 2}`;
  }
  if (dash === 'dot') {
    return `${width} ${width * 1.5}`;
  }

  return undefined;
}

function ShapeGeometryView({
  shapePath,
  fill,
  stroke,
  theme,
  resolveAsset,
}: {
  shapePath: ShapePath;
  fill: Paint;
  stroke: Stroke | undefined;
  theme: Theme | undefined;
  resolveAsset: (assetId: string) => string | undefined;
}) {
  const defId = useId();
  const { d, viewBox } = shapePath;
  const strokeProps = stroke
    ? {
        stroke: resolvePaint(stroke.color, stroke.opacity, theme),
        strokeWidth: stroke.widthPt * SDM_POINT_TO_UNIT,
        strokeDasharray: strokeDasharray(
          stroke.dash,
          stroke.widthPt * SDM_POINT_TO_UNIT,
        ),
        vectorEffect: 'non-scaling-stroke' as const,
      }
    : { stroke: 'none' };

  let fillValue = 'none';
  let fillOpacity: number | undefined;
  let defs: ReactNode = null;
  let imageLayer: ReactNode = null;

  if (fill.kind === 'solid') {
    fillValue = resolveColor(fill.color, theme);
    fillOpacity = fill.opacity;
  } else if (fill.kind === 'linearGradient') {
    const vector = gradientVector(fill.angleDeg);
    fillValue = `url(#${defId}-fill)`;
    defs = (
      <linearGradient id={`${defId}-fill`} {...vector}>
        {fill.stops.map((stop, index) => (
          <stop
            key={index}
            offset={stop.offset}
            stopColor={resolveColor(stop.color, theme)}
            stopOpacity={stop.opacity}
          />
        ))}
      </linearGradient>
    );
  } else if (fill.kind === 'image') {
    const src = resolveAsset(fill.assetId);
    if (src) {
      let aspect = 'xMidYMid slice';
      if (fill.fit === 'contain') {
        aspect = 'xMidYMid meet';
      } else if (fill.fit === 'fill') {
        aspect = 'none';
      }
      defs = (
        <clipPath id={`${defId}-clip`}>
          <path d={d} />
        </clipPath>
      );
      imageLayer = (
        <image
          href={src}
          width={viewBox.width}
          height={viewBox.height}
          preserveAspectRatio={aspect}
          clipPath={`url(#${defId}-clip)`}
          opacity={fill.opacity}
        />
      );
    }
  }

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${viewBox.width} ${viewBox.height}`}
      preserveAspectRatio="none"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'block',
        overflow: 'visible',
        pointerEvents: 'none',
      }}
    >
      {defs ? <defs>{defs}</defs> : null}
      {imageLayer}
      <path
        d={d}
        fill={imageLayer ? 'none' : fillValue}
        fillOpacity={fillOpacity}
        {...strokeProps}
      />
    </svg>
  );
}

const LINE_MARKERS: Record<string, { path: string; refX: number; size: number }> =
  {
    triangle: { path: 'M 0 0 L 6 3 L 0 6 Z', refX: 5, size: 6 },
    stealth: { path: 'M 0 0 L 6 3 L 0 6 L 1.6 3 Z', refX: 5, size: 6 },
    diamond: { path: 'M 3 0 L 6 3 L 3 6 L 0 3 Z', refX: 3, size: 6 },
    oval: { path: 'M 3 0 A 3 3 0 1 0 3 6 A 3 3 0 1 0 3 0 Z', refX: 3, size: 6 },
  };

function LineMarker({
  id,
  kind,
  color,
}: {
  id: string;
  kind: string;
  color: string;
}) {
  const marker = LINE_MARKERS[kind];
  if (!marker) {
    return null;
  }

  return (
    <marker
      id={id}
      viewBox={`0 0 ${marker.size} ${marker.size}`}
      refX={marker.refX}
      refY={marker.size / 2}
      markerWidth={marker.size}
      markerHeight={marker.size}
      orient="auto-start-reverse"
    >
      <path d={marker.path} fill={color} />
    </marker>
  );
}

function LineView({
  element,
  theme,
}: {
  element: Extract<Element, { type: 'line' }>;
  theme: Theme | undefined;
}) {
  const markerId = useId();
  const { stroke } = element;
  const color = resolvePaint(stroke.color, stroke.opacity, theme);
  const width = stroke.widthPt * SDM_POINT_TO_UNIT;
  const startMarker = stroke.startArrow && stroke.startArrow !== 'none';
  const endMarker = stroke.endArrow && stroke.endArrow !== 'none';
  let linecap: 'butt' | 'round' | 'square' = 'butt';
  if (stroke.cap === 'round') {
    linecap = 'round';
  } else if (stroke.cap === 'square') {
    linecap = 'square';
  }

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${element.frame.width} ${element.frame.height}`}
      style={{ display: 'block', overflow: 'visible', pointerEvents: 'none' }}
    >
      <defs>
        {startMarker ? (
          <LineMarker
            id={`${markerId}-start`}
            kind={stroke.startArrow ?? ''}
            color={color}
          />
        ) : null}
        {endMarker ? (
          <LineMarker
            id={`${markerId}-end`}
            kind={stroke.endArrow ?? ''}
            color={color}
          />
        ) : null}
      </defs>
      <polyline
        points={element.points.map((point) => `${point.x},${point.y}`).join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={width}
        strokeDasharray={strokeDasharray(stroke.dash, width)}
        strokeLinecap={linecap}
        markerStart={startMarker ? `url(#${markerId}-start)` : undefined}
        markerEnd={endMarker ? `url(#${markerId}-end)` : undefined}
      />
    </svg>
  );
}

function CroppedImage({
  src,
  alt,
  element,
}: {
  src: string;
  alt: string;
  element: Extract<Element, { type: 'image' }>;
}) {
  const crop = element.crop;
  const hasCrop =
    crop &&
    (crop.top > 0 || crop.right > 0 || crop.bottom > 0 || crop.left > 0);
  if (!hasCrop) {
    return (
      <img
        src={src}
        alt={alt}
        crossOrigin="anonymous"
        style={{
          width: '100%',
          height: '100%',
          objectFit: element.fit,
          display: 'block',
        }}
      />
    );
  }

  const visibleWidth = Math.max((100 - crop.left - crop.right) / 100, 0.01);
  const visibleHeight = Math.max((100 - crop.top - crop.bottom) / 100, 0.01);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <img
        src={src}
        alt={alt}
        crossOrigin="anonymous"
        style={{
          position: 'absolute',
          width: `${100 / visibleWidth}%`,
          height: `${100 / visibleHeight}%`,
          maxWidth: 'none',
          maxHeight: 'none',
          left: `${-crop.left / visibleWidth}%`,
          top: `${-crop.top / visibleHeight}%`,
          display: 'block',
        }}
      />
    </div>
  );
}

function WidgetView({
  element,
}: {
  element: Extract<Element, { type: 'widget' }>;
}) {
  const { widgets } = useContext(SdmRenderContext);
  const moduleKey = `..${element.widget.module.slice(1)}`;
  const mod = Object.hasOwn(widgets, moduleKey) ? widgets[moduleKey] : undefined;
  const exportName = element.widget.exportName ?? 'default';
  const widgetTarget = `${element.widget.module}#${exportName}`;
  if (!mod) {
    return (
      <WidgetFallback
        message={`Widget module not found: ${element.widget.module}`}
      />
    );
  }
  if (!Object.hasOwn(mod, exportName)) {
    return (
      <WidgetFallback
        message={`Widget export not found: ${widgetTarget}`}
      />
    );
  }

  const candidate = mod[exportName];
  if (!isWidgetComponent(candidate)) {
    return (
      <WidgetFallback
        message={`Widget export is not a component: ${widgetTarget}`}
      />
    );
  }

  const Widget = candidate;
  const rendered = <Widget {...(element.widget.props ?? {})} />;
  const fallback = (
    <WidgetFallback message={`Widget failed to render: ${widgetTarget}`} />
  );

  return (
    <WidgetErrorBoundary
      key={JSON.stringify(element.widget)}
      fallback={fallback}
    >
      {element.widget.sizing === 'fill' ? (
        <div className="h-full w-full [&>*]:h-full [&>*]:w-full">
          {rendered}
        </div>
      ) : (
        rendered
      )}
    </WidgetErrorBoundary>
  );
}

function WidgetFallback({ message }: { message: string }) {
  return (
    <div style={{ padding: 24, color: '#B91C1C', fontFamily: 'system-ui' }}>
      {message}
    </div>
  );
}

class WidgetErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function isWidgetComponent(
  value: unknown,
): value is ElementType<WidgetProps> {
  if (typeof value === 'function') {
    return true;
  }

  if (
    typeof value !== 'object' ||
    value === null ||
    !('$$typeof' in value)
  ) {
    return false;
  }
  if (value.$$typeof === Symbol.for('react.forward_ref')) {
    return 'render' in value && typeof value.render === 'function';
  }
  if (value.$$typeof === Symbol.for('react.memo')) {
    return 'type' in value && isWidgetComponent(value.type);
  }

  return false;
}

function normalizedPercentages(weights: Array<number>): Array<string> {
  const total = weights.reduce((sum, weight) => sum + weight, 0);

  return weights.map((weight) => `${(weight / total) * 100}%`);
}

function placeTableCells(element: Extract<Element, { type: 'table' }>) {
  const occupied = element.rows.map(() =>
    element.columns.map(() => false),
  );

  return element.rows.map((row, rowIndex) => {
    let columnIndex = 0;

    return row.cells.flatMap((cell, cellIndex) => {
      while (
        columnIndex < element.columns.length &&
        occupied[rowIndex][columnIndex]
      ) {
        columnIndex += 1;
      }
      if (columnIndex >= element.columns.length) {
        return [];
      }

      let colSpan = 1;
      while (
        colSpan < (cell.colSpan ?? 1) &&
        columnIndex + colSpan < element.columns.length &&
        !occupied[rowIndex][columnIndex + colSpan]
      ) {
        colSpan += 1;
      }
      const rowIsFree = (row: number) => {
        for (let offset = 0; offset < colSpan; offset += 1) {
          if (occupied[row][columnIndex + offset]) {
            return false;
          }
        }

        return true;
      };
      let rowSpan = 1;
      while (
        rowSpan < (cell.rowSpan ?? 1) &&
        rowIndex + rowSpan < element.rows.length &&
        rowIsFree(rowIndex + rowSpan)
      ) {
        rowSpan += 1;
      }
      for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
        for (let columnOffset = 0; columnOffset < colSpan; columnOffset += 1) {
          occupied[rowIndex + rowOffset][columnIndex + columnOffset] = true;
        }
      }
      columnIndex += colSpan;

      return [{ cell, cellIndex, colSpan, rowSpan }];
    });
  });
}

function ElementInner({
  element,
  document,
  onAction,
  textEditor,
}: {
  element: Element;
  document: SlideDocument;
  onAction?: (action: Action) => void;
  textEditor?: SdmTextEditorOptions;
}) {
  const { baseUrl } = useContext(SdmRenderContext);
  const theme = document.theme;
  const resolveAsset = (assetId: string) =>
    resolveAssetSrc(document.assets, assetId, baseUrl);
  switch (element.type) {
    case 'text': {
      const fill = element.fill
        ? paintToBackground(element.fill, theme, resolveAsset)
        : undefined;

      return (
        <div
          style={{
            width: '100%',
            height: '100%',
            position: 'relative',
            background: backgroundValue(fill),
            border: strokeToBorder(element.stroke, theme),
            boxSizing: 'border-box',
          }}
        >
          <PaintLayer resolved={fill} />
          <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <TextBodyView
              body={element.body}
              theme={theme}
              onAction={onAction}
              textEditor={textEditor}
            />
          </div>
        </div>
      );
    }
    case 'shape': {
      const shapePath = shapePathFor(
        element.geometry,
        element.frame.width,
        element.frame.height,
      );
      if (shapePath) {
        return (
          <div style={{ width: '100%', height: '100%', position: 'relative' }}>
            <ShapeGeometryView
              shapePath={shapePath}
              fill={element.fill}
              stroke={element.stroke}
              theme={theme}
              resolveAsset={resolveAsset}
            />
            {element.body ? (
              <div style={{ position: 'absolute', inset: 0 }}>
                <TextBodyView
                  body={element.body}
                  theme={theme}
                  onAction={onAction}
                  textEditor={textEditor}
                />
              </div>
            ) : null}
          </div>
        );
      }
      let radius: string | number | undefined;
      if (element.geometry.kind === 'preset') {
        if (element.geometry.preset === 'ellipse') {
          radius = '50%';
        } else if (element.geometry.preset === 'roundRect') {
          radius = element.geometry.cornerRadius ?? 20;
        }
      }
      const fill = paintToBackground(element.fill, theme, resolveAsset);

      return (
        <div
          style={{
            width: '100%',
            height: '100%',
            position: 'relative',
            background: backgroundValue(fill),
            border: strokeToBorder(element.stroke, theme),
            borderRadius: radius,
            boxSizing: 'border-box',
            overflow: 'hidden',
          }}
        >
          <PaintLayer resolved={fill} />
          {element.body ? (
            <div style={{ position: 'relative', width: '100%', height: '100%' }}>
              <TextBodyView
                body={element.body}
                theme={theme}
                onAction={onAction}
                textEditor={textEditor}
              />
            </div>
          ) : null}
        </div>
      );
    }
    case 'image': {
      const src = resolveAsset(element.assetId);
      return src ? (
        <CroppedImage src={src} alt={element.altText ?? ''} element={element} />
      ) : null;
    }
    case 'line':
      return <LineView element={element} theme={theme} />;
    case 'group': {
      const scaleX = element.frame.width / element.coordinateSpace.width;
      const scaleY = element.frame.height / element.coordinateSpace.height;
      return (
        <div
          style={{
            width: element.coordinateSpace.width,
            height: element.coordinateSpace.height,
            transform: `scale(${scaleX}, ${scaleY})`,
            transformOrigin: 'top left',
            overflow: element.clip ? 'hidden' : 'visible',
            position: 'relative',
          }}
        >
          {element.children.map((child) => (
            <SdmElementView
              key={child.id}
              element={child}
              document={document}
              onAction={onAction}
            />
          ))}
        </div>
      );
    }
    case 'table': {
      const columnWidths = normalizedPercentages(
        element.columns.map((column) => column.width),
      );
      const rowHeights = normalizedPercentages(
        element.rows.map(
          (row) => row.height ?? element.frame.height / element.rows.length,
        ),
      );
      const placedRows = placeTableCells(element);

      return (
        <table
          style={{
            width: '100%',
            height: '100%',
            borderCollapse: 'collapse',
            tableLayout: 'fixed',
          }}
        >
          <colgroup>
            {columnWidths.map((width, index) => (
              <col key={index} style={{ width }} />
            ))}
          </colgroup>
          <tbody>
            {placedRows.map((cells, rowIndex) => (
              <tr key={rowIndex} style={{ height: rowHeights[rowIndex] }}>
                {cells.map(({ cell, cellIndex, colSpan, rowSpan }) => {
                  const fill = cell.fill
                    ? paintToBackground(cell.fill, theme, resolveAsset)
                    : undefined;

                  return (
                    <td
                      key={cellIndex}
                      colSpan={colSpan}
                      rowSpan={rowSpan}
                      style={{
                        position: 'relative',
                        background: backgroundValue(fill),
                        border: '1px solid #CBD5E1',
                        padding: 0,
                      }}
                    >
                      <PaintLayer resolved={fill} />
                      <div
                        style={{
                          position: 'absolute',
                          inset: 0,
                        }}
                      >
                        <TextBodyView
                          body={cell.body}
                          theme={theme}
                          onAction={onAction}
                        />
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    case 'widget':
      return <WidgetView element={element} />;
  }
}

export function SdmElementView({
  element,
  document,
  onAction,
  textEditor,
}: {
  element: Element;
  document: SlideDocument;
  onAction?: (action: Action) => void;
  textEditor?: SdmTextEditorOptions;
}) {
  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (
      event.target instanceof globalThis.Element &&
      event.target.closest('[data-sdm-text-caret-active="true"]') !== null
    ) {
      event.stopPropagation();

      return;
    }
    if (!element.action) {
      return;
    }
    event.stopPropagation();
    if (element.action.kind === 'openUrl') {
      const safeUrl = sanitizeActionUrl(element.action.url);
      if (safeUrl) {
        window.open(
          safeUrl,
          element.action.target === 'sameWindow' ? '_self' : '_blank',
          'noopener,noreferrer',
        );
      }
      return;
    }
    onAction?.(element.action);
  };

  return (
    <div
      data-sdm-id={element.id}
      data-sdm-type={element.type}
      data-sdm-action={
        element.action ? JSON.stringify(element.action) : undefined
      }
      style={{
        ...frameStyle(element),
        cursor: element.action ? 'pointer' : undefined,
      }}
      onClick={handleClick}
    >
      <ElementInner
        element={element}
        document={document}
        onAction={onAction}
        textEditor={textEditor}
      />
    </div>
  );
}
