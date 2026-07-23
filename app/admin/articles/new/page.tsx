import { NewArticleForm } from "./NewArticleForm";

export const metadata = {
  title: "New Article",
};

export default function NewArticlePage() {
  return (
    <div className="max-w-xl">
      <h1 className="mb-2 text-2xl font-semibold text-veridan-ink">New article</h1>
      <p className="mb-6 text-sm text-veridan-warm-gray">
        Start with a title — everything else (body, excerpt, category, hero image, AI Assist) is
        filled in on the next screen.
      </p>
      <NewArticleForm />
    </div>
  );
}
