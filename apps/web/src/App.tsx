import { useEffect, useMemo, useState } from "react";
import type { Choice, Question, ResultsResponse } from "@paivankysymys/shared";
import { ApiError, getResults, getTodayQuestion, vote } from "./api";
import "./App.css";

function App() {
  const [question, setQuestion] = useState<Question | null>(null);
  const [results, setResults] = useState<ResultsResponse | null>(null);
  const [loadingQuestion, setLoadingQuestion] = useState(true);
  const [submittingVote, setSubmittingVote] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const loadQuestion = async () => {
      setLoadingQuestion(true);
      setError(null);

      try {
        const todayQuestion = await getTodayQuestion();
        setQuestion(todayQuestion);
      } catch (err) {
        setError(toErrorMessage(err));
      } finally {
        setLoadingQuestion(false);
      }
    };

    void loadQuestion();
  }, []);

  const totalVotes = useMemo(() => results?.total ?? 0, [results]);

  const handleVote = async (choice: Choice) => {
    if (!question || submittingVote) {
      return;
    }

    setSubmittingVote(true);
    setError(null);
    setNotice(null);

    try {
      await vote({ questionId: question.id, choice });
      setNotice("Kiitos äänestä!");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setNotice("Olet jo äänestänyt tänään.");
      } else {
        setError(toErrorMessage(err));
        setSubmittingVote(false);
        return;
      }
    }

    try {
      const latestResults = await getResults(question.id);
      setResults(latestResults);
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setSubmittingVote(false);
    }
  };

  return (
    <main className="page">
      <section className="card">
        <header className="heading">
          <p className="eyebrow">Päivän kysymys</p>
          <h1>A vai B?</h1>
        </header>

        {loadingQuestion && <p className="state">Ladataan kysymystä...</p>}
        {!loadingQuestion && !question && (
          <p className="state">Kysymystä ei löytynyt tälle päivälle.</p>
        )}

        {question && (
          <>
            <div className="question">
              <p className="date">{question.date}</p>
              <h2>{question.question}</h2>
            </div>

            <div className="actions">
              <button
                type="button"
                disabled={submittingVote}
                onClick={() => void handleVote("A")}
              >
                A: {question.optionA}
              </button>
              <button
                type="button"
                disabled={submittingVote}
                onClick={() => void handleVote("B")}
              >
                B: {question.optionB}
              </button>
            </div>
          </>
        )}

        {notice && <p className="notice">{notice}</p>}
        {error && <p className="error">{error}</p>}

        {results && question && (
          <section className="results">
            <h3>Tulokset</h3>
            <p className="votes">Yhteensä {totalVotes} vastausta</p>

            <ResultBar
              label={`A: ${question.optionA}`}
              percent={results.percentA}
              value={results.totalA}
              tone="a"
            />
            <ResultBar
              label={`B: ${question.optionB}`}
              percent={results.percentB}
              value={results.totalB}
              tone="b"
            />

            {results.segments.length > 0 && (
              <div className="segments">
                <h4>Segmentit</h4>
                <ul>
                  {results.segments.map((segment) => (
                    <li key={segment.segment}>
                      <span>{segment.segment}</span>
                      <span>
                        A {segment.percentA}% ({segment.a}) / B {segment.percentB}% (
                        {segment.b})
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}
      </section>
    </main>
  );
}

function ResultBar(props: {
  label: string;
  percent: number;
  value: number;
  tone: "a" | "b";
}) {
  return (
    <div className="result-bar">
      <div className="result-meta">
        <span>{props.label}</span>
        <span>
          {props.percent}% ({props.value})
        </span>
      </div>
      <div className="track">
        <div
          className={`fill ${props.tone}`}
          style={{ width: `${Math.min(100, Math.max(0, props.percent))}%` }}
        />
      </div>
    </div>
  );
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Tuntematon virhe";
}

export default App;
