import { Children, Fragment, type ReactNode } from "react";
import { View } from "react-native";

interface CardProps {
  children: ReactNode;
  className?: string;
}

/** Flat card container (DESIGN_SYSTEM.md §16) — border, no shadow. */
export function Card({ children, className }: CardProps) {
  return (
    <View
      className={`rounded-xl border border-border bg-card ${className ?? ""}`}
    >
      {children}
    </View>
  );
}

interface ListGroupProps {
  children: ReactNode;
  className?: string;
}

/** Card that renders its children as rows separated by inset dividers. */
export function ListGroup({ children, className }: ListGroupProps) {
  const items = Children.toArray(children).filter(Boolean);
  return (
    <View
      className={`overflow-hidden rounded-xl border border-border bg-card ${className ?? ""}`}
    >
      {items.map((child, index) => (
        <Fragment key={index}>
          {index > 0 && <View className="ml-4 h-px bg-divider" />}
          {child}
        </Fragment>
      ))}
    </View>
  );
}
