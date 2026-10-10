import React from 'react';
import styled, { css, createGlobalStyle, keyframes } from 'styled-components';

const SPACING = 8;
const BRAND = '#2563eb';
const colors = { primary: '#2563eb', muted: { text: '#6b7280' } };

const fade = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;

const flexCenter = css`
  display: flex;
  align-items: center;
`;

export const GlobalReset = createGlobalStyle`
  body {
    margin: 0;
    color: ${colors.muted.text};
  }
`;

export const Icon = styled.span`
  width: 16px;
  color: ${BRAND};
`;

export const Button = styled.button`
  ${flexCenter}
  padding: ${SPACING}px ${SPACING * 2}px;
  background-color: ${colors.primary};
  color: ${props => props.color};
  // line comment should be ignored
  border-radius: 4px;

  &:hover {
    background-color: darkblue;
  }

  :focus {
    outline: 2px solid ${BRAND};
  }

  && {
    font-weight: 700;
  }

  ${Icon} {
    margin-right: ${SPACING}px;
  }

  ${props => props.primary && css`
    background: ${props.theme.main};
  `}

  @media (min-width: 768px) {
    padding: 12px 24px;
  }
`;

export const PrimaryButton = styled(Button)`
  background-color: ${colors.primary};
  text-transform: uppercase;
`;

export const Wrapper = styled.div.attrs({ role: 'region' })`
  display: block;
`;

export default styled.section`
  margin: 0;
`;

export function Card() {
  return (
    <Wrapper>
      <Button primary>Go <Icon /></Button>
      <div css={{ color: 'red' }}>anon</div>
    </Wrapper>
  );
}
