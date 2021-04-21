(ns tres-game)

(use '[clojure.string :only (split)])

(def empty-square {:owner nil :count nil})

(def board {:a {:owner 1 :count 3} :b empty-square :c empty-square
            :d empty-square :e empty-square :f empty-square
            :g empty-square :h empty-square :i {:owner 2 :count 3}})

(defn get-moves []
  (println "Enter your move in the form <start><end><count> (e.g. \"ab3\"):")
  (let [move (read-line)]
    {:start (first move) :end (second move) :count (Integer. (second (split move #"[a-h]{2}")))}))

(defn update-board [board team-one-moves team-two-moves]
  (print board))

(defn play [board]
  (let [team-one-moves (repeat 3 (get-moves)) team-two-moves (repeat 3 get-moves)]
    (update-board board team-one-moves team-two-moves)))
