import Link from 'next/link';

type RecentInspirationsCardProps = {
  total: number;
  cover: string;
};

export default function RecentInspirationsCard({ total, cover }: RecentInspirationsCardProps) {
  return (
    <Link
      href="/tree"
      aria-label={`最近灵感，总共瞎想了${total}个灵感！`}
      className="rounded-3xl bg-white/40 dark:bg-slate-800/50 backdrop-blur-md border border-white/40 dark:border-white/10 shadow-xl overflow-hidden relative group min-h-[420px] h-full flex flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
    >
      <img
        src={cover}
        alt=""
        className="absolute inset-0 w-full h-full object-cover opacity-90 transition-transform duration-1000 group-hover:scale-105"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />

      <div className="relative z-10 flex flex-col justify-end p-6 w-full mt-auto h-full">
        <div className="flex items-center gap-2 mb-3">
          <span className="px-3 py-1 bg-indigo-500/80 backdrop-blur-lg rounded-full text-[10px] text-white font-black uppercase tracking-widest shadow-lg">
            Latest Insight
          </span>
        </div>
        <h2 className="text-2xl font-bold text-white mb-2 group-hover:-translate-y-1 transition-transform drop-shadow-md">
          最近灵感
        </h2>
        <p className="text-sm text-gray-300 line-clamp-3 drop-shadow-sm mb-6">
          总共瞎想了{total}个灵感！
        </p>
      </div>
    </Link>
  );
}
