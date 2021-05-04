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

(defn make-moves [board team-one-move team-two-move]
  ())

(defn update-board [board moves]
  (let [team-one-move (first moves)
        team-two-move (second moves)
        team-one-move-valid? (valid? board team-one-move 1)
        team-two-move-valid? (valid? board team-two-move 2)]
    (cond
      (and team-one-move-valid? team-two-move-valid?) (make-moves board team-one-move team-two-move)
      team-one-move-valid? (make-moves board team-one-move {})
      team-two-move-valid? (make-moves board {} team-two-move))))

(defn play [board]
  (let [team-one-moves (get-moves) team-two-moves (get-moves)]
    (reduce make-moves board (partition 2 (interleave team-one-moves team-two-moves)))))

;; (play board)
