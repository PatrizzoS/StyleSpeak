import styled from '@emotion/styled';
import { css } from '@emotion/react';

const gap = 12;
const theme = { radius: '6px' };

const base = css({
  boxSizing: 'border-box',
  margin: 0,
});

export const Panel = styled.div({
  ...base,
  padding: 16,
  opacity: 0.9,
  zIndex: 10,
  lineHeight: 1.5,
  borderRadius: theme.radius,
  fontSize: '14px',
  WebkitTransition: 'all .2s',
  msTransform: 'none',
  '--panel-bg': '#fff',
  color: props.color,
  '&:hover': {
    color: 'blue',
  },
  ':focus': {
    outline: 'none',
  },
  '@media (min-width: 600px)': {
    padding: gap,
  },
  '.title': {
    fontWeight: 600,
  },
});

export const Heading = styled('h2')(props => ({
  fontSize: 24,
  color: props.theme.heading,
}));

const buttonStyles = css`
  color: hotpink;
  &:hover { color: red; }
`;

export function Thing() {
  return <div css={buttonStyles}>x</div>;
}
