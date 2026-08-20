export interface MemberOption {
  id: string;
  slug: string;
  name: string;
  emoji: string;
  color: string;
  sortOrder: number;
}

export interface CategoryOption {
  id: string;
  slug: string;
  name: string;
  emoji: string;
  color: string;
  sortOrder: number;
}

export interface TemplateOption {
  id: string;
  name: string;
  categoryId: string;
  tag: "one_time" | "recurring" | "lifestyle";
  amountPaise: number;
  note: string | null;
  sortOrder: number;
}
