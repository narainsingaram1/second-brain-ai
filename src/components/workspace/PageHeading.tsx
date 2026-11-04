import { ReactNode } from "react";
interface Props {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}
export function PageHeading({ eyebrow, title, description, children }: Props) {
  return (
    <div className="page-heading">
      <div>
        <p className="workspace-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}
