import styled from 'styled-components';

interface Props { active: boolean }

export const Tab = styled.button<Props>`
  color: ${({ active }) => (active ? 'blue' : 'gray')};
  border: 1px solid transparent;
`;

export const Wrapper = styled.div<{ gap: number }>`
  display: grid;
`;
