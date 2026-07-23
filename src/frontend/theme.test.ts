import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

function themeBlock(source: string, selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, 'u').exec(
    source,
  );
  assert.ok(match?.[1], `Không tìm thấy block ${selector}`);
  return match[1];
}

function variable(block: string, name: string) {
  const match = new RegExp(`--${name}:\\s*([^;]+);`, 'u').exec(block);
  assert.ok(match?.[1], `Không tìm thấy token --${name}`);
  return match[1].trim();
}

function relativeLuminance(hex: string) {
  const channels = hex
    .slice(1)
    .match(/../gu)
    ?.map(value => Number.parseInt(value, 16) / 255)
    .map(value =>
      value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4,
    );
  assert.equal(channels?.length, 3);
  return (
    channels![0]! * 0.2126 +
    channels![1]! * 0.7152 +
    channels![2]! * 0.0722
  );
}

function contrast(left: string, right: string) {
  const values = [relativeLuminance(left), relativeLuminance(right)]
    .sort((a, b) => b - a);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

test('theme integration luôn được nạp sau stylesheet của mọi workflow', async () => {
  const mainSource = await readFile(
    new URL('./main.tsx', import.meta.url),
    'utf8',
  );
  const cssImports = [...mainSource.matchAll(/import ['"](\.\/[^'"]+\.css)['"]/gu)]
    .map(match => match[1]);

  assert.equal(cssImports.at(-1), './theme.css');
  assert.deepEqual(
    cssImports.slice(0, -1),
    [
      './styles.css',
      './voiceVisual.css',
      './motionCanvas.css',
      './voice.css',
      './sync.css',
      './layout.css',
      './render.css',
    ],
  );
});

test('canvas và panel giữ phân cấp thị giác ở cả Light lẫn Dark mode', async () => {
  const styles = await readFile(
    new URL('./styles.css', import.meta.url),
    'utf8',
  );
  const light = themeBlock(styles, ':root');
  const dark = themeBlock(styles, ':root[data-theme="dark"]');

  assert.ok(
    contrast(variable(light, 'canvas'), variable(light, 'paper')) >= 1.15,
    'Light mode cần tách panel khỏi canvas rõ hơn.',
  );
  assert.ok(
    contrast(variable(dark, 'canvas'), variable(dark, 'paper')) >= 1.2,
    'Dark mode cần tách panel khỏi canvas rõ hơn.',
  );
  for (const block of [light, dark]) {
    assert.match(variable(block, 'shadow'), /,/u);
    assert.match(variable(block, 'line-strong'), /^#[0-9a-f]{6}$/iu);
    assert.match(variable(block, 'control-bg'), /^#[0-9a-f]{6}$/iu);
  }
});

test('dark mode bao phủ các surface độc lập của toàn bộ pipeline', async () => {
  const theme = await readFile(
    new URL('./theme.css', import.meta.url),
    'utf8',
  );
  const criticalSurfaces = [
    '.topic-ai-guidance',
    '.outline-section-card',
    '.voice-visual-beat',
    '.voice-config-heading',
    '.voice-search',
    '.motion-canvas-command',
    '.sync-flow-visual',
    '.layout-output-settings',
    '.layout-inspector',
    '.layout-shortcut-dialog',
    '.render-progress-card',
    '.project-library',
    '.elevenlabs-connection-card .codex-connection-actions button',
  ];

  for (const selector of criticalSurfaces) {
    assert.ok(
      theme.includes(selector),
      `Thiếu dark-mode override cho ${selector}`,
    );
  }
  assert.match(
    theme,
    /Keep authored media surfaces independent from the application theme/u,
  );
});
