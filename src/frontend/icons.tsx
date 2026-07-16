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

export function ArrowLeftIcon(props: IconProps) {
  return (
    <svg {...iconDefaults} {...props}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </svg>
  );
}
