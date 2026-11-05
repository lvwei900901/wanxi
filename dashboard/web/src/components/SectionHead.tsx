import type { ReactNode } from 'react';

interface Props {
  index: string;
  title: string;
  note?: ReactNode;
  id?: string;
}

export function SectionHead({ index, title, note, id }: Props) {
  return (
    <div className="section__head" id={id}>
      <span className="section__index" aria-hidden="true">
        {index}
      </span>
      <h2 className="section__title">{title}</h2>
      {note && <span className="section__note">{note}</span>}
    </div>
  );
}
