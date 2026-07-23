import type {SVGProps} from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const iconDefaults: IconProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

export function ArrowRightIcon(props: IconProps) {
  return (
    <svg {...iconDefaults} {...props}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...iconDefaults} {...props}>
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <svg {...iconDefaults} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

export function LayersIcon(props: IconProps) {
  return (
    <svg {...iconDefaults} {...props}>
      <path d="m12 3 8 4.5-8 4.5-8-4.5L12 3Z" />
      <path d="m4 12 8 4.5 8-4.5M4 16.5 12 21l8-4.5" />
    </svg>
  );
}

export function LightbulbIcon(props: IconProps) {
  return (
    <svg {...iconDefaults} {...props}>
      <path d="M9 18h6M10 21h4" />
      <path d="M8.2 14.7A6 6 0 1 1 15.8 14.7c-.8.6-.8 1.3-.8 1.3H9s0-.7-.8-1.3Z" />
    </svg>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <svg {...iconDefaults} {...props}>
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10" />
    </svg>
  );
}

export function SparkIcon(props: IconProps) {
  return (
    <svg {...iconDefaults} {...props}>
      <path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3Z" />
      <path d="m18.5 14 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z" />
      <path d="m5.5 12 .6 1.9 1.9.6-1.9.6L5.5 17l-.6-1.9-1.9-.6 1.9-.6.6-1.9Z" />
    </svg>
  );
}

export function UserIcon(props: IconProps) {
  return (
    <svg {...iconDefaults} {...props}>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
    </svg>
  );
}

export function FolderIcon(props: IconProps) {
  return (
    <svg {...iconDefaults} {...props}>
      <path d="M3.5 7.5h6l2-2h9v13h-17v-11Z" />
      <path d="M3.5 9.5h17" />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...iconDefaults} {...props}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <svg {...iconDefaults} {...props}>
      <path d="M4.5 7h15M9 7V4.5h6V7M7 7l.8 13h8.4L17 7" />
      <path d="M10 11v5M14 11v5" />
    </svg>
  );
}

export function XIcon(props: IconProps) {
  return (
    <svg {...iconDefaults} {...props}>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <svg {...iconDefaults} {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <svg {...iconDefaults} {...props}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </svg>
  );
}

export function UndoIcon(props: IconProps) {
  return (
    <svg {...iconDefaults} {...props}>
      <path d="M9 7 4.5 11 9 15" />
      <path d="M5 11h7.5a6 6 0 0 1 6 6" />
    </svg>
  );
}

export function RedoIcon(props: IconProps) {
  return (
    <svg {...iconDefaults} {...props}>
      <path d="m15 7 4.5 4-4.5 4" />
      <path d="M19 11h-7.5a6 6 0 0 0-6 6" />
    </svg>
  );
}

export function EyeIcon(props: IconProps) {
  return (
    <svg {...iconDefaults} {...props}>
      <path d="M3.5 12s3-5 8.5-5 8.5 5 8.5 5-3 5-8.5 5-8.5-5-8.5-5Z" />
      <circle cx="12" cy="12" r="2.2" />
    </svg>
  );
}

export function EyeOffIcon(props: IconProps) {
  return (
    <svg {...iconDefaults} {...props}>
      <path d="m4 4 16 16" />
      <path d="M9.4 7.5A8.8 8.8 0 0 1 12 7c5.5 0 8.5 5 8.5 5a12 12 0 0 1-2.1 2.7M14.7 16.6c-.8.3-1.7.4-2.7.4-5.5 0-8.5-5-8.5-5a12.6 12.6 0 0 1 2.3-2.9" />
    </svg>
  );
}

export function RotateIcon(props: IconProps) {
  return (
    <svg {...iconDefaults} {...props}>
      <path d="M19 8V4l-2 2a8 8 0 1 0 2.1 8" />
      <path d="M19 4h-4" />
    </svg>
  );
}

export function PaletteIcon(props: IconProps) {
  return (
    <svg {...iconDefaults} {...props}>
      <path d="M12 3a9 9 0 0 0 0 18h1.2a2 2 0 0 0 1.7-3c-.5-.8.1-1.8 1-1.8H18a3 3 0 0 0 3-3C21 7.6 17 3 12 3Z" />
      <circle cx="7.5" cy="11" r=".8" fill="currentColor" stroke="none" />
      <circle cx="10" cy="7.5" r=".8" fill="currentColor" stroke="none" />
      <circle cx="14" cy="7.2" r=".8" fill="currentColor" stroke="none" />
      <circle cx="17" cy="10" r=".8" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ResetIcon(props: IconProps) {
  return (
    <svg {...iconDefaults} {...props}>
      <path d="M4 7v5h5" />
      <path d="M5.5 11A7.5 7.5 0 1 1 7 17.5" />
    </svg>
  );
}

export function UnlockIcon(props: IconProps) {
  return (
    <svg {...iconDefaults} {...props}>
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8.5 10V7.5a3.5 3.5 0 0 1 6.8-1.2" />
    </svg>
  );
}

export function ChevronUpIcon(props: IconProps) {
  return (
    <svg {...iconDefaults} {...props}>
      <path d="m7 14 5-5 5 5" />
    </svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <svg {...iconDefaults} {...props}>
      <path d="m7 10 5 5 5-5" />
    </svg>
  );
}

export function KeyboardIcon(props: IconProps) {
  return (
    <svg {...iconDefaults} {...props}>
      <rect x="3" y="6" width="18" height="12" rx="2.5" />
      <path d="M7 10h.01M10.5 10h.01M14 10h.01M17.5 10h.01M7 13.5h.01M10.5 13.5h.01M14 13.5h3.5M7 16h7" />
    </svg>
  );
}

export function ExpandIcon(props: IconProps) {
  return (
    <svg {...iconDefaults} {...props}>
      <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
      <path d="m3 8 5-5M21 8l-5-5M3 16l5 5M21 16l-5 5" />
    </svg>
  );
}

export function MinimizeIcon(props: IconProps) {
  return (
    <svg {...iconDefaults} {...props}>
      <path d="M8 8H3M8 8V3M16 8h5M16 8V3M8 16H3M8 16v5M16 16h5M16 16v5" />
      <path d="M8 8 3 3M16 8l5-5M8 16l-5 5M16 16l5 5" />
    </svg>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <svg {...iconDefaults} {...props}>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <svg {...iconDefaults} {...props}>
      <path d="M20.2 15.2A8.7 8.7 0 0 1 8.8 3.8 8.8 8.8 0 1 0 20.2 15.2Z" />
    </svg>
  );
}
