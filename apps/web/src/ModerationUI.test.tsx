import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AiReviewBadge, ReviewDecisionPanel, reviewWarnings } from "./ModerationUI";
import { StoryReviewQueue, filterReviewQueue, processReviewBatch } from "./StoryReviewQueue";
import * as adminApi from "./api/admin";
import type { ReviewSubmission } from "./api/admin";

afterEach(() => vi.restoreAllMocks());

const base: ReviewSubmission = { id: "1", title: "Đường về kỳ ảo", author: "Nguyễn An", summary: "", language: "vi", publicationDate: null, aiReviewStatus: "skipped", aiReviewWarnings: [], totalChapters: 28, submittedBy: "u1", submittedByName: "Tác giả Bình", createdAt: "2026-10-29T06:30:00Z" };
const items = [base, { ...base, id: "2", aiReviewStatus: "warnings", aiReviewWarnings: [{ message: "Kiểm tra <script>" }] }, { ...base, id: "3", title: "Truyện khác", author: "Mai", aiReviewStatus: "passed" }];
describe("moderation interface", () => {
  it("does not report a manual or unfinished review as AI approved", () => {
    for (const status of ["skipped", "not_started", "pending", "unknown"]) {
      const markup = renderToStaticMarkup(<AiReviewBadge status={status} />);
      expect(markup).not.toContain("AI đã rà soát"); expect(markup).not.toContain("status-ok");
    }
    expect(renderToStaticMarkup(<AiReviewBadge status="passed" />)).toContain("AI đã rà soát");
    const warning = renderToStaticMarkup(<AiReviewBadge status="warnings" warnings={items[1].aiReviewWarnings} />);
    expect(warning).toContain("1 cảnh báo"); expect(warning).toContain("status-warning");
    expect(reviewWarnings([{ message: "<script>" }, null, "Lưu ý"])).toEqual(["<script>", "Có cảnh báo AI cần được xem xét.", "Lưu ý"]);
  });
  it("combines AI state with accent-insensitive title, author and submitter search", () => {
    expect(filterReviewQueue(items, "duong ve", "warnings").map((item) => item.id)).toEqual(["2"]);
    expect(filterReviewQueue(items, "nguyen an", "skipped").map((item) => item.id)).toEqual(["1"]);
    expect(filterReviewQueue(items, "tac gia binh", "all")).toHaveLength(3);
    expect(filterReviewQueue(items, "missing", "all")).toHaveLength(0);
  });
  it("requires a reason for changes or rejection and locks all decision inputs while saving", () => {
    const render = (reason: string, busy = false) => renderToStaticMarkup(<ReviewDecisionPanel reason={reason} busy={busy} approveLabel="Duyệt và xuất bản" description="Kiểm tra nội dung trước khi duyệt." onReasonChange={() => {}} onDecide={() => {}} />);
    const empty = render("   ");
    expect(empty).toContain('disabled="" type="button">Yêu cầu chỉnh sửa');
    expect(empty).toContain('disabled="" type="button">Từ chối');
    expect(empty).not.toContain('disabled="" type="button">Duyệt và xuất bản');
    expect(render("Lý do")).not.toContain('disabled=""');
    expect((render("Lý do", true).match(/disabled=""/g) ?? []).length).toBe(4);
  });
  it("renders a populated queue with correct review badges and content routes", () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    client.setQueryData(["admin", "queue"], items);
    const markup = renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter><StoryReviewQueue /></MemoryRouter></QueryClientProvider>);
    expect(markup).toContain('href="/reviews/1"'); expect(markup).toContain('href="/reviews/2"');
    expect(markup).toContain("Duyệt thủ công · chưa rà soát AI");
    expect(markup).toContain("Chọn truyện đang hiển thị");
    expect(markup).not.toContain("Áp dụng cho 0 truyện");
  });
  it("continues after an individual failure and reports each outcome without resubmitting successes", async () => {
    const request = vi.spyOn(adminApi, "decideReview").mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Truyện đã được xử lý ở phiên khác.")).mockResolvedValueOnce(undefined);
    const progress = vi.fn(); const onResults = vi.fn();
    const results = await processReviewBatch(items, "approve", "", progress, onResults);
    expect(request.mock.calls).toEqual([["1", "approve", undefined], ["2", "approve", undefined], ["3", "approve", undefined]]);
    expect(results.filter((item) => item.error).map((item) => item.id)).toEqual(["2"]);
    expect(results.filter((item) => !item.error).map((item) => item.id)).toEqual(["1", "3"]);
    expect(onResults.mock.calls[0][0]).toHaveLength(1);
    expect(onResults.mock.calls[2][0]).toHaveLength(3);
    expect(progress).toHaveBeenCalledTimes(3);
  });
  it("sends the selected decision and trimmed reason, and makes no request for an empty selection", async () => {
    const request = vi.spyOn(adminApi, "decideReview").mockResolvedValue(undefined);
    await processReviewBatch([base], "changes_requested", "  Kiểm tra chương 2  ", () => {}, () => {});
    expect(request).toHaveBeenCalledWith("1", "changes_requested", "Kiểm tra chương 2");
    request.mockClear();
    expect(await processReviewBatch([], "approve", "", () => {}, () => {})).toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });
});
