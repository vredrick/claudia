/**
 * Claude-themed syntax highlighting theme
 * Features orange, purple, and violet colors to match Claude's aesthetic
 */
export const claudeSyntaxTheme: any = {
  'code[class*="language-"]': {
    color: '#e0e0e0',
    background: 'transparent',
    textShadow: 'none',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.875em',
    textAlign: 'left',
    whiteSpace: 'pre',
    wordSpacing: 'normal',
    wordBreak: 'normal',
    wordWrap: 'normal',
    lineHeight: '1.5',
    MozTabSize: '4',
    OTabSize: '4',
    tabSize: '4',
    WebkitHyphens: 'none',
    MozHyphens: 'none',
    msHyphens: 'none',
    hyphens: 'none',
  },
  'pre[class*="language-"]': {
    color: '#e0e0e0',
    background: 'transparent',
    textShadow: 'none',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.875em',
    textAlign: 'left',
    whiteSpace: 'pre',
    wordSpacing: 'normal',
    wordBreak: 'normal',
    wordWrap: 'normal',
    lineHeight: '1.5',
    MozTabSize: '4',
    OTabSize: '4',
    tabSize: '4',
    WebkitHyphens: 'none',
    MozHyphens: 'none',
    msHyphens: 'none',
    hyphens: 'none',
    padding: '1em',
    margin: '0',
    overflow: 'auto',
  },
  ':not(pre) > code[class*="language-"]': {
    background: 'rgba(255, 107, 53, 0.1)',
    padding: '0.1em 0.3em',
    borderRadius: '0.3em',
    whiteSpace: 'normal',
  },
  'comment': {
    color: '#71717a',
    fontStyle: 'italic',
  },
  'prolog': {
    color: '#71717a',
  },
  'doctype': {
    color: '#71717a',
  },
  'cdata': {
    color: '#71717a',
  },
  'punctuation': {
    color: '#a1a1aa',
  },
  'namespace': {
    opacity: '0.7',
  },
  'property': {
    color: '#fb923c', // Vibrant Orange
  },
  'tag': {
    color: '#a78bfa', // Bright Purple
  },
  'boolean': {
    color: '#fb923c', // Vibrant Orange
  },
  'number': {
    color: '#fbbf24', // Bright Yellow
  },
  'constant': {
    color: '#fb923c', // Vibrant Orange
  },
  'symbol': {
    color: '#fb923c', // Vibrant Orange
  },
  'deleted': {
    color: '#f87171',
  },
  'selector': {
    color: '#c084fc', // Bright Light Purple
  },
  'attr-name': {
    color: '#c084fc', // Bright Light Purple
  },
  'string': {
    color: '#4ade80', // Bright Green
  },
  'char': {
    color: '#4ade80', // Bright Green
  },
  'builtin': {
    color: '#a78bfa', // Bright Purple
  },
  'url': {
    color: '#4ade80', // Bright Green
  },
  'inserted': {
    color: '#4ade80', // Bright Green
  },
  'entity': {
    color: '#c084fc', // Bright Light Purple
    cursor: 'help',
  },
  'atrule': {
    color: '#e879f9', // Bright Magenta
  },
  'attr-value': {
    color: '#4ade80', // Bright Green
  },
  'keyword': {
    color: '#e879f9', // Bright Magenta
  },
  'function': {
    color: '#93c5fd', // Bright Blue
  },
  'class-name': {
    color: '#fbbf24', // Bright Yellow
  },
  'regex': {
    color: '#22d3ee', // Bright Cyan
  },
  'important': {
    color: '#fb923c', // Vibrant Orange
    fontWeight: 'bold',
  },
  'variable': {
    color: '#c084fc', // Bright Light Purple
  },
  'bold': {
    fontWeight: 'bold',
  },
  'italic': {
    fontStyle: 'italic',
  },
  'operator': {
    color: '#9ca3af',
  },
  'script': {
    color: '#e0e0e0',
  },
  'parameter': {
    color: '#fbbf24', // Yellow
  },
  'method': {
    color: '#818cf8', // Indigo
  },
  'field': {
    color: '#f59e0b', // Amber/Orange
  },
  'annotation': {
    color: '#6b7280',
  },
  'type': {
    color: '#a78bfa', // Light Purple
  },
  'module': {
    color: '#8b5cf6', // Violet
  },
}; 