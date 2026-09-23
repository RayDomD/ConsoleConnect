export type ThemeId = 'forest' | 'blue' | 'ochre';

export interface Theme {
  id: ThemeId;
  name: string;
  tokens: {
    canvas: string; sidebar: string; surface: string; text: string; muted: string;
    border: string; accent: string; accentHover: string; onAccent: string;
    selection: string; focus: string; success: string; warning: string; danger: string;
  };
  terminal: {
    background: string; foreground: string; cursor: string; cursorAccent: string;
    selectionBackground: string; selectionForeground: string;
    black: string; red: string; green: string; yellow: string;
    blue: string; magenta: string; cyan: string; white: string;
    brightBlack: string; brightRed: string; brightGreen: string; brightYellow: string;
    brightBlue: string; brightMagenta: string; brightCyan: string; brightWhite: string;
  };
}

const terminalColors = {
  black: '#292723', red: '#A02F37', green: '#2D624B', yellow: '#805517',
  blue: '#355CA8', magenta: '#784882', cyan: '#236876', white: '#62676C',
  brightBlack: '#5B6167', brightRed: '#B13540', brightGreen: '#346F4B', brightYellow: '#895B10',
  brightBlue: '#345EC1', brightMagenta: '#8C428E', brightCyan: '#246E7A', brightWhite: '#53595F',
};

function palette(id: ThemeId, name: string, colors: Omit<Theme['tokens'], 'success' | 'warning' | 'danger' | 'focus'>): Theme {
  return {
    id, name,
    tokens: { ...colors, focus: colors.accent, success: '#2D624B', warning: '#805517', danger: '#A02F37' },
    terminal: {
      ...terminalColors, background: colors.surface, foreground: colors.text,
      cursor: colors.accent, cursorAccent: colors.onAccent,
      selectionBackground: colors.selection, selectionForeground: colors.text,
    },
  };
}

export const themes: readonly Theme[] = [
  palette('forest', 'Forest & linen', {
    canvas: '#F4F2E9', sidebar: '#E5E9DF', surface: '#FCFBF5', text: '#253A30', muted: '#5B6B5E',
    border: '#CDD5C7', accent: '#2D624B', accentHover: '#234E3C', onAccent: '#FCFBF5', selection: '#DCE6D8',
  }),
  palette('blue', 'Blue & porcelain', {
    canvas: '#F3F5F8', sidebar: '#E4EAF1', surface: '#FCFDFE', text: '#24354D', muted: '#596B80',
    border: '#CDD6E1', accent: '#355CA8', accentHover: '#294986', onAccent: '#FCFDFE', selection: '#D9E4F5',
  }),
  palette('ochre', 'Ochre & parchment', {
    canvas: '#F7F1E6', sidebar: '#EEE3D1', surface: '#FFFCF5', text: '#3D3026', muted: '#77614F',
    border: '#DCCDB9', accent: '#9A4F19', accentHover: '#7C3E13', onAccent: '#FFFCF5', selection: '#EBDCC5',
  }),
];

export const defaultThemeId: ThemeId = 'forest';
export function isThemeId(value: unknown): value is ThemeId {
  return themes.some(theme => theme.id === value);
}
export function getTheme(id: ThemeId): Theme {
  const theme = themes.find(item => item.id === id);
  if (!theme) throw new Error('Unknown theme. Choose one of the available themes.');
  return theme;
}
