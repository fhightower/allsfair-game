(ns tres-game)

(use '[utils :only (empty-square process-move)])

(def board {:a {:owner 1 :count 3} :b empty-square :c empty-square
            :d empty-square :e empty-square :f empty-square
            :g empty-square :h empty-square :i {:owner 2 :count 3}})

(defn get-move []
  (println "Enter your move in the form <start><end><count> (e.g. \"ab3\"):")
  (process-move (read-line)))

(defn get-moves []
  (repeatedly 3 get-move))

(defn valid? [board move owner]
  (and
    (= (get (get board (get move :start)) :owner) owner)
    (>= (get (get board (get move :start)) :count) (get move :count))))

(defn make-move [board moves]
  (let [team-one-move (first moves)
        team-two-move (second moves)
        team-one-move-valid? (valid? board team-one-move 1)
        team-two-move-valid? (valid? board team-two-move 2)]
    (cond
      (and team-one-move-valid? team-two-move-valid?) "a"
      team-one-move-valid? "b"
      team-two-move-valid? "c")))

(defn update-board [board team-one-moves team-two-moves]
  (reduce make-move board (partition 2 (interleave team-one-moves team-two-moves))))

(defn play [board]
  (let [team-one-moves (get-moves) team-two-moves (get-moves)]
    (update-board board team-one-moves team-two-moves)))

;; (play board)
