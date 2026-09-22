import StarterKit from "@tiptap/starter-kit";
import type { AnyExtension } from "@tiptap/core";
import type { Family } from "@/lib/docmodel/schema";
import { GepaDocument } from "./document";
import { GepaParagraph } from "./paragraph";
import { ApprovalBlock, Blank, GepaImage, NoticeHeader, OfficialFooter, OfficialHeader, PageBreak, PressHeader } from "./atoms";
import { GepaCell, GepaRow, GepaTable } from "./table";
import {
  AttachmentItem,
  AttachmentList,
  ChapterBand,
  CoverTitle,
  FlowName,
  FlowStage,
  FlowWhen,
  InfoBox,
  InfoGroup,
  InfoHeading,
  InfoItem,
  OverviewLabel,
  OverviewRow,
  OverviewSpacer,
  OverviewTable,
  OverviewValue,
  ProcedureFlow,
  SectionBar,
  SectionChip,
  SummaryBox,
  SummaryLine,
} from "./composites";
import { GepaStyle } from "./marks";
import { TypingCaret } from "./caret";

export interface GepaExtensionOptions {
  family: Family;
  /** optional node-view overrides (React views are attached by HwpEditor, keeping this list DOM-free) */
  overrides?: Partial<Record<"approvalBlock" | "noticeHeader" | "pressHeader", AnyExtension>>;
}

/**
 * The complete extension list for a family. Order matters: `gepaParagraph` is registered
 * first among block nodes so it is the default block ProseMirror creates on Enter.
 */
export function gepaExtensions({ family, overrides = {} }: GepaExtensionOptions): AnyExtension[] {
  return [
    GepaDocument,
    StarterKit.configure({
      document: false,
      paragraph: false,
      heading: false,
      blockquote: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      listKeymap: false,
      code: false,
      codeBlock: false,
      horizontalRule: false,
      italic: false,
      strike: false,
      underline: false,
      trailingNode: false,
      link: { openOnClick: false, autolink: false, linkOnPaste: true },
    }),
    GepaParagraph.configure({ family }),
    Blank,
    PageBreak,
    GepaImage,
    GepaTable.configure({ family }),
    GepaRow,
    GepaCell,
    ChapterBand,
    SectionChip,
    SummaryBox,
    SummaryLine,
    overrides.approvalBlock ?? ApprovalBlock,
    CoverTitle,
    SectionBar,
    InfoBox,
    InfoGroup,
    InfoHeading,
    InfoItem,
    OverviewTable,
    OverviewRow,
    OverviewSpacer,
    OverviewLabel,
    OverviewValue,
    ProcedureFlow,
    FlowStage,
    FlowName,
    FlowWhen,
    overrides.noticeHeader ?? NoticeHeader,
    overrides.pressHeader ?? PressHeader,
    AttachmentList,
    AttachmentItem,
    OfficialHeader,
    OfficialFooter,
    GepaStyle,
    TypingCaret,
  ];
}

export { GepaDocument, GepaParagraph, Blank, PageBreak, GepaImage, ApprovalBlock, NoticeHeader, PressHeader, OfficialHeader, OfficialFooter, GepaTable, GepaRow, GepaCell, GepaStyle, TypingCaret };
