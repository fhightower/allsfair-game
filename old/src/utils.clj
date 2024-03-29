(ns utils)

(defn process-move [move]
  {:start (first move) :end (second move) :count (Integer. (apply str (nthrest move 2)))})

(defn get-move []
  (println "Enter your move in the form <start><end><count> (e.g. \"ab3\"):")
  (process-move (read-line)))

(defn get-moves []
  (repeatedly 3 get-move))

(defn- get-teams-on-board [board]
  (distinct (remove nil? (map #(:owner %) (vals board)))))

(defn get-winner [board]
  (let [teams (get-teams-on-board board)
        game-over (= (count teams) 1)]
    (if (true? game-over)
      (first teams)
      nil)))

(defn update-start-square [board move]
  (let [square (get move :start)
        count (get move :count)]
    {:owner (get (get board square) :owner)
     :count (- (get (get board square) :count) count)}))

(defn update-end-square [board move]
  (let [square (get move :end)
        count (get move :count)]
    {:owner (get (get board square) :owner)
     :count (+ (get (get board square) :count) count)}))

;; (defn make-moves [board team-one-move team-two-move]
;;   (cond
;;     (empty? team-one-move) (assoc board
;;                                   (get team-two-move :start) (update-start-square board team-two-move)
;;                                   (get team-two-move :end) {:owner
;;                                                             :count (- (get (get team-two-move :start) :count) (get team-two-move :count))})
;;     (empty? team-two-move) ()
;;     ; todo: implement the line below
;;     :else ()))

;; (defn valid? [board move owner]
;;   (and
;;    (= (get (get board (get move :start)) :owner) owner)
;;    (>= (get (get board (get move :start)) :count) 1)))

;; (defn update-board [board moves]
;;   (let [team-one-move (first moves)
;;         team-two-move (second moves)
;;         team-one-move-valid? (valid? board team-one-move 1)
;;         team-two-move-valid? (valid? board team-two-move 2)]
;;     (cond
;;       (and team-one-move-valid? team-two-move-valid?) (make-moves board team-one-move team-two-move)
;;       team-one-move-valid? (make-moves board team-one-move {})
;;       team-two-move-valid? (make-moves board {} team-two-move))))

;; (defn apply-move [board move]
;;   )

;; (defn make-moves [board move-pair]
;;   (let [team-one-move (first move-pair)
;;         team-two-move (second move-pair)]
;;     ))
