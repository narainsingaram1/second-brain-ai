import { ReactNode } from "react";
interface Props {
  /** Kept for callers; page titles no longer carry an eyebrow label. */
  eyebrow?: string;
  title: string;
  description: string;
  children?: ReactNode;
}
export function PageHeading({ title, description, children }: Props) {
  return (
    <div className="page-heading">
      <div>
        <h1 className="page-title">{title}</h1>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}
